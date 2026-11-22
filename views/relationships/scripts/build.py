"""Build the standalone graph from the site's shared, generated data snapshot."""
from pathlib import Path
from base64 import b64encode
import argparse
import csv
import json

VIEW = Path(__file__).resolve().parent.parent
ROOT = VIEW.parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--data-dir', type=Path, default=ROOT / 'public/data')
parser.add_argument('--output', type=Path, default=ROOT / 'public/relationships/index.html')
args = parser.parse_args()

def read_json(name):
    return json.loads((args.data_dir / name).read_text(encoding='utf-8'))

entities = read_json('entities.json')
relations = read_json('relations.json')
# sources.csv identifies ties as source-type-target, whereas GraphCore uses a
# JSON tuple as its collision-safe internal ID. Map only unambiguous IDs.
keys = {}
for edge in relations['relations']:
    source_id = '-'.join((edge['source'], edge['type'], edge['target']))
    internal_id = json.dumps([edge['source'], edge['target'], edge['type']], ensure_ascii=False, separators=(',', ':'))
    keys.setdefault(source_id, set()).add(internal_id)
with (args.data_dir / 'sources.csv').open(encoding='utf-8-sig', newline='') as f:
    provenance = list(csv.DictReader(f))
for row in provenance:
    matches = keys.get(row.get('backs_id'), set())
    if row.get('backs_kind') == 'relationship' and len(matches) == 1:
        row['original_backs_id'] = row['backs_id']
        row['backs_id'] = next(iter(matches))
bundle = {'entities': entities, 'relations': relations, 'ledger': read_json('deal-ledger.json'),
          'meta': read_json('shared-snapshot.json'), 'aliases': [], 'provenance': provenance}
text = (VIEW / 'index.template.html').read_text(encoding='utf-8')
font_package = ROOT / 'node_modules/@fontsource-variable/dm-sans'
font = b64encode((font_package / 'files/dm-sans-latin-wght-normal.woff2').read_bytes()).decode('ascii')
font_license = (font_package / 'LICENSE').read_text(encoding='utf-8')
font_style = (
    f'/* {font_license} */\n'
    '@font-face{font-family:"DM Sans Variable";font-style:normal;font-weight:100 1000;'
    f'font-display:swap;src:url(data:font/woff2;base64,{font}) format("woff2");}}\n'
)
theme = (ROOT / 'public/dashboard-theme.css').read_text(encoding='utf-8')
for marker, value in {'/* CSS */': font_style + theme + (VIEW / 'styles.css').read_text(encoding='utf-8'),
                      '/* DATA */': json.dumps(bundle, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c'),
                      '/* D3 */': (VIEW / 'vendor/d3.v7.9.0.min.js').read_text(encoding='utf-8'),
                      '/* CORE */': (VIEW / 'core.js').read_text(encoding='utf-8'),
                      '/* APP */': (VIEW / 'app.js').read_text(encoding='utf-8')}.items():
    if text.count(marker) != 1:
        raise ValueError(f'Expected one {marker} marker in template')
    text = text.replace(marker, value)
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(text, encoding='utf-8')
print(f'Built {args.output}: {len(text.encode()):,} bytes; no runtime network requests.')
