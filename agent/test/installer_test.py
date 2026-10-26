"""Real installer + systemd lifecycle in a disposable Docker Linux instance."""
import hashlib
import http.server
import json
import os
import pathlib
import pty
import secrets
import select
import ssl
import subprocess
import threading
import time
import sys

def run(*args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.decode().strip()

def until(predicate, timeout=25):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        if predicate(): return
        time.sleep(.1)
    raise AssertionError('Timed out waiting for installation lifecycle')

compose_mode='--compose-fixture' in sys.argv
origin='https://agent-receiver:8443' if compose_mode else 'https://127.0.0.1:8443'
if not compose_mode: until(lambda: pathlib.Path('/run/systemd/system').is_dir())
run('openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1,DNS:agent-receiver','-keyout','/tmp/fixture.key','-out','/usr/local/share/ca-certificates/pulsy-fixture.crt')
run('update-ca-certificates')
expected=secrets.token_urlsafe(32)
received=[]
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        if self.path=='/verification':
            metrics=received[-1] if received else {}
            memory={line.split(':')[0]:int(line.split()[1]) for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if line.startswith(('MemTotal:','MemAvailable:'))}
            expected_memory=100*(memory['MemTotal']-memory['MemAvailable'])/memory['MemTotal']
            expected_uptime=float(pathlib.Path('/proc/uptime').read_text().split()[0])
            valid=metrics.get('memoryPercent') is not None and abs(metrics['memoryPercent']-expected_memory)<5 and metrics.get('uptimeSeconds') is not None and abs(metrics['uptimeSeconds']-expected_uptime)<90 and any(fs['path']=='/' for fs in metrics.get('filesystems',[]))
            self.send_response(200);self.end_headers();self.wfile.write(json.dumps({'reports':len(received),'metricsValid':valid,'cpuReady':metrics.get('cpuPercent') is not None}).encode());return
        prefix='/api/agent/releases/v1.0.0/'
        if not self.path.startswith(prefix): self.send_error(404);return
        name=self.path[len(prefix):]
        if name not in ['install.sh','compose.yaml','SHA256SUMS','pulsy-agent-linux-amd64','pulsy-agent-linux-arm64']: self.send_error(404);return
        body=pathlib.Path('/artifacts/v1.0.0',name).read_bytes()
        self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_POST(self):
        length=int(self.headers.get('Content-Length','0'))
        if length>49152: self.send_error(413);return
        body=self.rfile.read(length)
        if self.path!='/api/agent/v1/metrics' or self.headers.get('Authorization')!='Bearer '+expected: self.send_error(401);return
        received.append(json.loads(body))
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"outcome":"accepted","interval":60,"excludedFilesystems":[]}')
server=http.server.ThreadingHTTPServer(('0.0.0.0',8443),Handler)
context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain('/usr/local/share/ca-certificates/pulsy-fixture.crt','/tmp/fixture.key');server.socket=context.wrap_socket(server.socket,server_side=True)
threading.Thread(target=server.serve_forever,daemon=True).start()

def install(mode=None,credential=None):
    args=['bash','/test/install.sh']+([mode] if mode else [])+[origin]
    pid,fd=pty.fork()
    if pid==0: os.execvp(args[0],args)
    output=b'';sent=False;end=time.monotonic()+90
    try:
        while time.monotonic()<end:
            if select.select([fd],[],[],.2)[0]:
                try: chunk=os.read(fd,4096)
                except OSError: break
                if not chunk: break
                output+=chunk
                if b'Agent credential (hidden):' in output and not sent:
                    assert credential is not None,'Unexpected credential prompt'
                    os.write(fd,(credential+'\n').encode());sent=True
            child,status=os.waitpid(pid,os.WNOHANG)
            if child:
                assert os.waitstatus_to_exitcode(status)==0,output.decode(errors='replace')
                break
        else: raise AssertionError('Installer timed out')
        child,status=os.waitpid(pid,0)
        assert os.waitstatus_to_exitcode(status)==0,output.decode(errors='replace')
    except ChildProcessError: pass
    finally: os.close(fd)
    assert expected.encode() not in output,'Credential echoed'
    if credential: assert credential.encode() not in output,'Credential echoed'

def install_stdin(mode,credential,env=None):
    # Unattended path used by the copied command: no TTY, credential piped on stdin.
    args=['bash','/test/install.sh']+([mode] if mode else [])+['--credential-stdin',origin]
    result=subprocess.run(args,input=(credential+'\n').encode(),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,timeout=90)
    assert result.returncode==0,result.stdout.decode(errors='replace')
    assert b'Agent credential' not in result.stdout,'Unexpected credential prompt'
    assert credential.encode() not in result.stdout,'Credential echoed'

def docker_calls():
    log=pathlib.Path('/tmp/docker.log')
    return log.read_text().splitlines() if log.exists() else []

if compose_mode:
    install('--compose',expected)
    pathlib.Path('/opt/pulsy-agent/ca.crt').write_bytes(pathlib.Path('/usr/local/share/ca-certificates/pulsy-fixture.crt').read_bytes())
    os.chmod('/opt/pulsy-agent/ca.crt',0o644)
    pathlib.Path('/opt/pulsy-agent/ready').touch()
    threading.Event().wait()

install(credential=expected)
until(lambda: len(received)>0)
config=pathlib.Path('/etc/pulsy-agent/config.json')
assert config.stat().st_mode&0o777==0o600
assert run('systemctl','is-active','pulsy-agent')=='active'
assert run('systemctl','show','pulsy-agent','-p','User','--value')=='pulsy-agent'
assert received[0]['memoryPercent'] is not None
assert received[0]['cpuPercent'] is None
original=config.read_bytes()
# Conflicting modes must fail before uninstalling or changing a running service.
for flags in [('--uninstall','--compose'),('--upgrade','--rotate'),('--compose','--compose'),('--credential-stdin','--upgrade'),('--uninstall','--credential-stdin'),('--credential-stdin','--credential-stdin'),('--unknown',)]:
    rejected=subprocess.run(['bash','/test/install.sh',*flags],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    assert rejected.returncode!=0 and config.read_bytes()==original
    assert run('systemctl','is-active','pulsy-agent')=='active'
for mode in [None,'--upgrade']:
    count=len(received);install(mode);until(lambda:len(received)>count);assert config.read_bytes()==original
count=len(received);run('systemctl','restart','pulsy-agent');until(lambda:len(received)>count)
expected=secrets.token_urlsafe(32);count=len(received);install('--rotate',expected);until(lambda:len(received)>count)
assert json.loads(config.read_text())['token']==expected
# Unattended systemd install/rotation: the piped credential replaces the configuration.
expected=secrets.token_urlsafe(32);count=len(received);install_stdin(None,expected);until(lambda:len(received)>count)
assert json.loads(config.read_text())['token']==expected and config.stat().st_mode&0o777==0o600
assert run('systemctl','is-active','pulsy-agent')=='active'
assert not any(path.name=='credential' for path in pathlib.Path('/usr/local/lib/pulsy-agent').rglob('*')),'Credential file left behind'
bad=subprocess.run(['bash','/test/install.sh','--credential-stdin',origin],input=b'not-a-credential\n',stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
assert bad.returncode!=0 and b'Invalid agent credential' in bad.stdout and json.loads(config.read_text())['token']==expected
# Execute the ARM binary without changing the host's binfmt registrations.
assert run('qemu-aarch64','/artifacts/v1.0.0/pulsy-agent-linux-arm64','-version')=='1.0.0'
arm=json.loads(run('qemu-aarch64','/artifacts/v1.0.0/pulsy-agent-linux-arm64','-config',str(config),'-collect-once'))
assert arm['agent']['arch']=='arm64' and arm['memoryPercent'] is not None
install('--compose',expected)
compose=json.loads(pathlib.Path('/opt/pulsy-agent/config.json').read_text())
assert compose['proc']=='/host/proc' and compose['root']=='/host/root'
assert pathlib.Path('/opt/pulsy-agent/config.json').stat().st_uid==65532
# Compose starts (recreates) the container and confirms it is running.
calls=docker_calls()
assert 'compose --project-directory /opt/pulsy-agent up -d --force-recreate' in calls,calls
assert 'compose --project-directory /opt/pulsy-agent ps --status running --quiet pulsy-agent' in calls,calls
compose_token=secrets.token_urlsafe(32);pathlib.Path('/tmp/docker.log').unlink()
install_stdin('--compose',compose_token)
assert json.loads(pathlib.Path('/opt/pulsy-agent/config.json').read_text())['token']==compose_token
assert 'compose --project-directory /opt/pulsy-agent up -d --force-recreate' in docker_calls()
# Without Docker Compose the installer stops before prompting or touching files.
before=pathlib.Path('/opt/pulsy-agent/config.json').read_bytes()
no_docker=subprocess.run(['bash','/test/install.sh','--compose','--credential-stdin',origin],input=(compose_token+'\n').encode(),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env={**os.environ,'PATH':'/usr/sbin:/usr/bin:/sbin:/bin'})
assert no_docker.returncode!=0 and b'Docker with the Compose plugin is required' in no_docker.stdout,no_docker.stdout
assert pathlib.Path('/opt/pulsy-agent/config.json').read_bytes()==before
install('--uninstall')
assert not config.exists() and not pathlib.Path('/usr/local/bin/pulsy-agent').exists()
assert subprocess.run(['systemctl','is-active','--quiet','pulsy-agent']).returncode!=0
server.shutdown()
print('PASS: verified download, clean systemd install, reinstall, upgrade, restart, credential rotation, unattended stdin credential, uninstall, Compose configuration and auto-start, amd64 reporting and arm64 execution')
