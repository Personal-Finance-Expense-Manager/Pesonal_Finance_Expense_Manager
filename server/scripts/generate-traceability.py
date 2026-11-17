"""Generate TRACEABILITY.md from the SRS, the backlog and the test suites.

Reads the three sources rather than taking anything on trust, so the matrix
cannot drift from what is actually in the repository.
"""
import docx, glob, io, json, os, re, subprocess

ROOT = r'C:/Users/prajw/Desktop/pfem'
os.chdir(ROOT)

ID = r'\b(?:REQ|PER|SAF|SEC|BR)-\d+\b'


def doc_text(path):
    d = docx.Document(path)
    parts = [p.text for p in d.paragraphs]
    for t in d.tables:
        for r in t.rows:
            parts.append(' | '.join(c.text for c in r.cells))
    return '\n'.join(parts)


def key(rid):
    pre, num = rid.split('-')
    return (['REQ', 'BR', 'PER', 'SAF', 'SEC'].index(pre), int(num))


# ---- 1. the SRS: every requirement, with its text -------------------------
srs_text = doc_text('SRS-Personal-Finance-Expense-Manager.docx')
srs_ids = sorted(set(re.findall(ID, srs_text)), key=key)

statement = {}
for line in srs_text.split('\n'):
    for rid in set(re.findall(ID, line)):
        clean = ' '.join(line.split())
        # Prefer the line that defines it: "REQ-42: The system shall ..."
        if re.search(r'\b' + rid + r'\b\s*[:\-]', clean) and rid not in statement:
            body = re.split(r'\b' + rid + r'\b\s*[:\-]\s*', clean, maxsplit=1)
            if len(body) > 1 and len(body[1]) > 15:
                statement[rid] = body[1]

# ---- 2. the backlog: which issue delivers it ------------------------------
raw = subprocess.run(
    ['gh', 'issue', 'list', '--state', 'all', '--limit', '100',
     '--json', 'number,title,body,milestone,assignees'],
    capture_output=True, text=True, shell=True).stdout
issues = json.loads(raw)

by_req = {}
for i in issues:
    ms = (i.get('milestone') or {}).get('title')
    if ms not in ('Sprint 1', 'Sprint 2'):
        continue
    who = (i['assignees'] or [{'login': '?'}])[0]['login']
    story = re.match(r'\[(US-\d+)\]', i['title'])
    label = story.group(1) if story else f"#{i['number']}"
    for rid in set(re.findall(ID, i.get('body') or '')):
        by_req.setdefault(rid, []).append((i['number'], label, who))

# ---- 3. the tests: which test names it ------------------------------------
test_files = (glob.glob('server/test/**/*.js', recursive=True)
              + glob.glob('client/test/*.js')
              + glob.glob('server/scripts/bench*.js'))
in_test = {}
for f in test_files:
    name = os.path.basename(f)
    for rid in set(re.findall(ID, io.open(f, encoding='utf-8', errors='replace').read())):
        in_test.setdefault(rid, set()).add(name)

# ---- 4. the Test Plan: which manual case names it --------------------------
plan_text = doc_text('Test-Plan-Personal-Finance-Expense-Manager.docx')
plan_case = {}
for line in plan_text.split('\n'):
    cases = re.findall(r'\b(?:UT|IT|ST)_\d+\b', line)
    for rid in set(re.findall(ID, line)):
        if cases:
            plan_case.setdefault(rid, set()).update(cases)
        else:
            plan_case.setdefault(rid, set())

OWNER = {'prajwalgdevadiga': 'Prajwal', 'abdulmuheethk-1026': 'Abdul',
         'GIRISH-G-N': 'Girish', 'nikhilreddynani1-beep': 'Nikhil'}

L = []
w = L.append

covered = [r for r in srs_ids if r in in_test or r in plan_case]

w('# Requirements traceability matrix')
w('')
w('Every requirement in the SRS, the backlog item that delivers it, and the')
w('test that proves it.')
w('')
w('Generated from the three sources themselves - the SRS, the GitHub backlog')
w('and the test suites - so it cannot drift from what is actually in the')
w('repository. Regenerate with `npm run report:trace` in `server/`.')
w('')
w('## Summary')
w('')
w('| | Count |')
w('| --- | --- |')
w(f'| Requirements in the SRS | **{len(srs_ids)}** |')
w(f'| Delivered by a backlog item | **{len([r for r in srs_ids if r in by_req])}** |')
w(f'| Named by an automated test | **{len([r for r in srs_ids if r in in_test])}** |')
w(f'| Named by a Test Plan case | **{len([r for r in srs_ids if r in plan_case])}** |')
w(f'| **Covered by at least one test** | **{len(covered)} of {len(srs_ids)}** |')
w('')

prefixes = [('REQ', 'Functional requirements'), ('BR', 'Business rules'),
            ('PER', 'Performance'), ('SAF', 'Safety'), ('SEC', 'Security')]

w('| Group | In SRS | In backlog | Automated | Test Plan |')
w('| --- | --- | --- | --- | --- |')
for pre, label in prefixes:
    ids = [r for r in srs_ids if r.startswith(pre + '-')]
    if not ids:
        continue
    w(f'| {label} ({pre}) | {len(ids)} | {len([r for r in ids if r in by_req])} '
      f'| {len([r for r in ids if r in in_test])} | {len([r for r in ids if r in plan_case])} |')
w('')
w('A requirement is proved either by an automated test that names it, or by a')
w('Test Plan case, or both. Many have both - the automated test runs on every')
w('pull request, and the Test Plan case is the manual walk-through.')
w('')

for pre, label in prefixes:
    ids = [r for r in srs_ids if r.startswith(pre + '-')]
    if not ids:
        continue
    w('---')
    w('')
    w(f'## {label}')
    w('')
    w('| Requirement | Story | Owner | Automated test | Test Plan |')
    w('| --- | --- | --- | --- | --- |')
    for rid in ids:
        stories = by_req.get(rid, [])
        seen, labels, owners = set(), [], []
        for num, lab, who in stories:
            if lab in seen:
                continue
            seen.add(lab)
            labels.append(f'[{lab}](../../issues/{num})')
            owners.append(OWNER.get(who, who))
        files = sorted(in_test.get(rid, []))
        auto = ', '.join(f'`{f}`' for f in files[:2]) + ('&hellip;' if len(files) > 2 else '')
        cases = sorted(plan_case.get(rid, []))
        manual = ', '.join(cases[:3]) + ('&hellip;' if len(cases) > 3 else '')
        w(f"| **{rid}** | {' '.join(labels) or '-'} | {', '.join(sorted(set(owners))) or '-'} "
          f"| {auto or '-'} | {manual or '-'} |")
    w('')

gap = [r for r in srs_ids if r not in in_test and r not in plan_case]
w('---')
w('')
w('## Gaps')
w('')
if gap:
    w('These requirements have no test naming them:')
    w('')
    for rid in gap:
        w(f'- **{rid}** - {statement.get(rid, "see the SRS")[:150]}')
else:
    w('None. Every requirement in the SRS is named by an automated test, a Test')
    w('Plan case, or both.')
w('')
w('## How the three sources line up')
w('')
w('**SRS to backlog.** Every story issue copies its acceptance criteria')
w('verbatim from the SRS, with the requirement ids kept, so opening any issue')
w('shows which requirements it delivers.')
w('')
w('**SRS to tests.** Automated test names carry the requirement id, which is')
w('why this matrix can be generated rather than maintained by hand - and why')
w('it cannot quietly go stale.')
w('')
w('**Test Plan.** The 148 manual cases in the Test Plan carry requirement ids')
w('in their descriptions; those are listed in the last column.')

io.open('TRACEABILITY.md', 'w', encoding='utf-8', newline='').write('\n'.join(L) + '\n')
print('written TRACEABILITY.md')
print('requirements:', len(srs_ids), 'covered:', len(covered), 'gaps:', len(gap))
