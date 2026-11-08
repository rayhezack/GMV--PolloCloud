"""Verify live dashboard responses against every daily additive drilldown and activity tier."""
import json
import pathlib
import urllib.request
import urllib.parse

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def fetch(route, **params):
    params['verify'] = 'creation-history-310'
    with opener.open('http://127.0.0.1:5191/api/dashboard/' + route + '?' + urllib.parse.urlencode(params), timeout=180) as response:
        return json.load(response)

results = []
for platform in ['web', 'app', 'all']:
    params = dict(platform=platform, startDate='2026-01-01', endDate='2026-11-06', baselinePeriod='2026-10-24', analysisPeriod='2026-10-31')
    data = fetch('creative-overview', **params)
    assert data['ready'], (platform, data)
    trend = data['trend']
    assert len(trend) == 310, (platform, len(trend))
    fields = ['creationTaskCnt', 'validCreationTaskCnt', 'successTaskCnt', 'successOutputCnt', 'adoptedTaskCnt', 'adoptedOutputCnt', 'gmvUsd']
    child = {}
    for function in data['functions']:
        for point in function['daily']:
            totals = child.setdefault(point['period'], dict.fromkeys(fields, 0))
            for key in fields:
                totals[key] += point[key]
    for point in trend:
        for key in fields:
            actual, expected = point[key], child[point['period']][key]
            assert (round(actual * 1000000) == round(expected * 1000000)) if key == 'gmvUsd' else actual == expected, (platform, point['period'], key, actual, expected)
    params.update(dimension='creative', startDate='2026-10-24')
    tiers = fetch('attributions', **params)
    days = tiers['comparison']['analysisPeriodDays']
    current = [point for point in trend if '2026-10-31' <= point['period'] <= '2026-11-06']
    for key in ['activeUv', 'creationUv', 'creationTaskCnt']:
        actual = sum(point['activity'][key] for point in current) / days
        expected = sum(item['metrics'][key] for item in tiers['items'])
        assert abs(actual - expected) < 1e-8, (platform, key, actual, expected)
    results.append(dict(platform=platform, days=len(trend), first=trend[0]['period'], last=trend[-1]['period'], functionGroups=len(data['functions']), additiveMismatchGroups=0, activityTierMismatchGroups=0, latestActivity=trend[-1]['activity']))
    print(json.dumps(results[-1], ensure_ascii=False), flush=True)
pathlib.Path('archives/creation-history-2026-01-01-2026-11-06/api-audit.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
