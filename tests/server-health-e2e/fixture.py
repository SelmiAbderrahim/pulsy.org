"""Network-isolated acceptance fixture. Never packaged in a release image."""
import http.server,json,pathlib,subprocess,threading,os,pty,select,time
ROOT=pathlib.Path('/fixture'); ROOT.mkdir(exist_ok=True)
def run(*args): return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout
run('openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=pulsy-e2e','-addext','subjectAltName=DNS:pulsy-e2e','-keyout','/fixture/key.pem','-out','/fixture/ca.crt')
pathlib.Path('/usr/local/share/ca-certificates/pulsy-e2e.crt').write_bytes((ROOT/'ca.crt').read_bytes());run('update-ca-certificates')
notifications=[]
def install(token,rotate=False):
    run('curl','--fail','--silent','--show-error','https://pulsy-e2e/api/agent/releases/v1.0.0/install.sh','-o','/tmp/install.sh')
    args=['bash','/tmp/install.sh']+(['--rotate'] if rotate else [])+['https://pulsy-e2e']
    pid,fd=pty.fork()
    if pid==0: os.execvp(args[0],args)
    output=b'';sent=False;deadline=time.monotonic()+90
    try:
        while time.monotonic()<deadline:
            if select.select([fd],[],[],.2)[0]:
                try: part=os.read(fd,4096)
                except OSError: break
                if not part: break
                output+=part
                if b'Agent credential (hidden):' in output and not sent: os.write(fd,(token+'\n').encode());sent=True
        else: raise RuntimeError('Installer timeout')
        _,status=os.waitpid(pid,0)
        assert os.waitstatus_to_exitcode(status)==0,'Installer failed (output intentionally withheld)'
        assert token.encode() not in output,'Credential echoed'
    finally: os.close(fd)
    assert pathlib.Path('/etc/pulsy-agent/config.json').stat().st_mode&0o777==0o600
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def reply(self,data):
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(data).encode())
    def do_GET(self):
        if self.path=='/notifications': self.reply({'events':[{'status':{'monitor.degraded':'degraded','monitor.up':'up','monitor.down':'down'}.get(n.get('event')),'reason':n.get('reason')} for n in notifications]})
        else: self.reply({'ready':True,'generation':int((ROOT/'generation').read_text()) if (ROOT/'generation').exists() else 0})
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or '{}')
        try:
            if self.path=='/notify': notifications.append(data)
            elif self.path in ['/install','/rotate']: install(data['token'],self.path=='/rotate')
            elif self.path=='/stop': run('systemctl','stop','pulsy-agent')
            elif self.path=='/start': run('systemctl','start','pulsy-agent')
            elif self.path=='/memory':
                proc=pathlib.Path('/var/lib/pulsy-e2e-proc');proc.mkdir(exist_ok=True)
                for name in ['stat','sys','uptime','loadavg','1']:
                    if not (proc/name).exists(): (proc/name).symlink_to('/proc/'+name)
                (proc/'meminfo').write_text('MemTotal: 1000000 kB\nMemAvailable: '+('50000' if data['high'] else '600000')+' kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n')
                config=pathlib.Path('/etc/pulsy-agent/config.json');value=json.loads(config.read_text())
                if value['proc']!=str(proc):
                    value['proc']=str(proc);config.write_text(json.dumps(value));run('systemctl','restart','pulsy-agent')
            elif self.path=='/restart-backend': (ROOT/'restart-request').touch()
            else: self.send_error(404);return
            self.reply({'ok':True})
        except Exception:
            self.send_error(500,'Fixture operation failed; sensitive output withheld')
http.server.ThreadingHTTPServer(('0.0.0.0',8080),Handler).serve_forever()
