import io

p = 'src/adapters/threads.ts'
s = io.open(p, encoding='utf8').read()

# Repair shell-mangled backtick duplication from the earlier inline patch.
s = s.replace('threads_media``/${uid}/threads_media`,', 'threads_media`,')
s = s.replace('threads_media``/${uid}/threads_publish`,', 'threads_publish`,')

io.open(p, 'w', encoding='utf8', newline='\n').write(s)
for line in s.split('\n'):
    if 'threads_media' in line or 'threads_publish' in line:
        print(line.strip()[:120])
