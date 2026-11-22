"""Capture a complete aggregate-only warehouse SELECT as local evidence, with no dashboard/D1 reads."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(__doc__)
parser.add_argument('sql')
parser.add_argument('output')
parser.add_argument('--captured-stream', help='Recover a completed stream from this audit after local metadata parsing failed')
args = parser.parse_args()
source, target = Path(args.sql).resolve(), Path(args.output).resolve()
if target.exists():
    raise SystemExit(f'Refusing to overwrite evidence: {target}')
sql = source.read_text().strip()
if not sql.upper().startswith(('SELECT ', 'WITH ')):
    raise SystemExit('SELECT/WITH only')
stream = target.with_suffix('.jsonl')
if stream.exists():
    raise SystemExit(f'Refusing to overwrite result stream: {stream}')
helper = Path.home() / '.codex/skills/aliyun-maxcompute-warehouse/scripts/pollo_mcp_query.py'
python = '/Users/ray/Downloads/pollo-ask-data-20261112-0d7c902/.mcp_server/.venv/bin/python'
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
command = [python, str(helper), 'execute_sql', '--arguments', json.dumps({
    'sql': sql, 'async': False, 'timeout': 120, 'output_uri': stream.as_uri(),
})]
if args.captured_stream:
    stream = Path(args.captured_stream).resolve()
    payload = {'success': True, 'outputPath': str(stream), 'metadataRecoveredFromCompleteStream': True}
else:
    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise SystemExit(result.stderr)
    payload = json.loads(result.stdout)
    target.with_suffix('.query-metadata.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    if not payload.get('success') or payload.get('rowCount', 0) == 0:
        raise SystemExit(json.dumps(payload, ensure_ascii=False))
    stream = Path(payload.get('outputPath', str(stream))).resolve()
if stream.exists():
    data = [json.loads(line) for line in stream.read_text().splitlines() if line.strip()]
else:
    if payload.get('truncated'):
        raise SystemExit('Truncated result without output stream')
    data = payload.get('data', [])
if args.captured_stream:
    payload['rowCount'] = len(data)
if len(data) != payload['rowCount']:
    raise SystemExit(f'Incomplete result: {len(data)} != {payload["rowCount"]}')
counts = {int(row['source_row_count']) for row in data if 'source_row_count' in row}
if counts and counts != {len(data)}:
    raise SystemExit(f'SQL row-count contract failed: {counts} != {len(data)}')
output = {'capturedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'startedAtUtc': None if args.captured_stream else started,
          'streamCompletedAtUtc': datetime.datetime.fromtimestamp(stream.stat().st_mtime, datetime.timezone.utc).isoformat() if stream.exists() else None,
          'sqlSha256': hashlib.sha256(sql.encode()).hexdigest(),
          'rowCount': len(data), 'sqlRowCountVerified': bool(counts), 'data': data,
          'queryMetadata': {k: v for k, v in payload.items() if k not in ('data', 'rawOutput')}}
target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'file': str(target), 'rows': len(data), 'sqlRowCountVerified': bool(counts)}, ensure_ascii=False))
