import subprocess
with open('design_note.txt', 'r') as f:
    note = f.read()
result = subprocess.run(['br', 'update', 'create-harness-app-z1d', '--claim', '--force', '--design', note, '--actor', 'BlackKite'], capture_output=True, text=True)
print('STDOUT:', result.stdout)
print('STDERR:', result.stderr)
if result.returncode != 0:
    exit(result.returncode)