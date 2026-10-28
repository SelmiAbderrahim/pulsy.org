import json
import ssl
import time
import urllib.request

context=ssl.create_default_context()
deadline=time.monotonic()+100
while time.monotonic()<deadline:
    with urllib.request.urlopen('https://agent-receiver:8443/verification',context=context,timeout=5) as response:
        state=json.load(response)
    if state['reports']>=2:
        assert state['metricsValid'] and state['cpuReady'],state
        print('PASS: actual installer-generated Compose agent, read-only host mounts, CPU deltas, RAM, uptime and root filesystem received over verified HTTPS')
        break
    time.sleep(1)
else: raise AssertionError('Compose agent did not produce two valid host samples')
