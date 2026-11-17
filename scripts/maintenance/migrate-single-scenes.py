"""One-off local history migration. Back up JSON; preserve files still referenced anywhere in project JSON."""
import json, os, shutil
from pathlib import Path
from datetime import datetime
root = Path.home() / '.gdream/aigc-memory/projects'
stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
backup = Path.home() / '.gdream-migration-backups' / ('single-scenes-' + stamp)
removed = set()
counts = {'projects': 0, 'scenes': 0, 'shots': 0, 'trashed': 0, 'stillReferenced': 0, 'missing': 0}
for path in root.glob('*/workshop.json'):
    data = json.loads(path.read_text())
    original = path.read_bytes()
    changed = False
    for scene in data.get('scenes', []):
        paths = scene.get('selectedImagePaths') or []
        if len(paths) <= 1 and scene.get('sceneReferenceMode') != 'multi': continue
        primary = scene.get('assetImagePath') or (paths[0] if paths else None)
        if not primary: continue
        removed.update(p for p in paths if p != primary)
        removed.update(c['path'] for c in scene.get('candidates', []) if c.get('path') and c['path'] != primary)
        scene.update(assetImagePath=primary, selectedImagePaths=[primary], candidates=[c for c in scene.get('candidates', []) if c.get('path') == primary])
        scene.pop('sceneReferenceMode', None)
        for shot in data.get('shots', []):
            if shot.get('sceneId') == scene.get('id'):
                shot.update(sceneImagePaths=[primary], promptNeedsRefresh=True)
                counts['shots'] += 1
        counts['scenes'] += 1
        changed = True
    if changed:
        dest = backup / path.parent.name / path.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(original)
        tmp = path.with_suffix('.single-scene.tmp')
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        os.replace(tmp, path)
        counts['projects'] += 1
# Any remaining reference, including generation receipts, protects the file.
strings = set()
def collect(value):
    if isinstance(value, str): strings.add(value)
    elif isinstance(value, list):
        for item in value: collect(item)
    elif isinstance(value, dict):
        for item in value.values(): collect(item)
for path in root.rglob('*.json'):
    try: collect(json.loads(path.read_text()))
    except (ValueError, OSError): pass
trash = Path.home() / '.Trash' / ('gdream-old-scene-views-' + stamp)
for value in removed:
    if value in strings:
        counts['stillReferenced'] += 1
        continue
    path = Path(value)
    if not path.is_absolute() or not path.is_file():
        counts['missing'] += 1
        continue
    # Only generated files inside GDream are eligible for physical removal.
    if not path.resolve().is_relative_to(Path.home() / '.gdream'): continue
    trash.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(trash / (str(counts['trashed']) + '-' + path.name)))
    counts['trashed'] += 1
print(json.dumps({'counts': counts, 'backup': str(backup)}, ensure_ascii=False))
