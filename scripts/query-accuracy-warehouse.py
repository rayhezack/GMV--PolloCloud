"""Run an audit SELECT via the existing device-bound warehouse skill, with result guards."""
import argparse
import json
import pathlib
import subprocess

p = argparse.ArgumentParser(__doc__)
p.add_argument('sql')
p.add_argument('output')
args = p.parse_args()
statement = pathlib.Path(args.sql).read_text().strip()
if not statement.upper().startswith(('SELECT ', 'WITH ')):
    raise SystemExit('Only SELECT/WITH audit queries are allowed')
helper = pathlib.Path.home()/'.codex/skills/aliyun-maxcompute-warehouse/scripts/pollo_mcp_query.py'
python = '/Users/ray/Downloads/pollo-ask-data-20261112-0d7c902/.mcp_server/.venv/bin/python'
result = subprocess.run([python,str(helper),'execute_sql','--arguments',json.dumps(
    {'sql':statement,'async':False,'timeout':120})],capture_output=True,text=True,timeout=160)
if result.returncode:
    raise SystemExit(result.stderr)
payload = json.loads(result.stdout)
if not payload.get('success') or payload.get('truncated') or not payload.get('data'):
    raise SystemExit(json.dumps(payload,ensure_ascii=False))
if len(payload['data']) != payload.get('rowCount'):
    raise SystemExit('Warehouse row count does not match the returned result')
pathlib.Path(args.output).write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in payload.items() if k!='data'},ensure_ascii=False))
