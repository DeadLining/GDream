#!/usr/bin/env python3
"""Repair historical extraction receipts. Local FFmpeg only; never alter shot inputs or generate media via providers."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=120).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-dir', required=True, type=Path)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--ffprobe', default='ffprobe')
    args = parser.parse_args()
    project = args.project_dir.resolve()
    workshop = project / 'workshop.json'
    snapshot = json.loads(workshop.read_text())
    ledger_path = project / 'media-provenance.json'
    ledger_bytes = ledger_path.read_bytes() if ledger_path.exists() else None
    ledger = json.loads(ledger_bytes) if ledger_bytes else {'version': 1, 'records': []}
    receipts = []
    output_dir = project / 'shots' / 'actual-tails'
    output_dir.mkdir(parents=True, exist_ok=True)
    for shot in snapshot['shots']:
        if not shot.get('videoPath'):
            continue
        source = Path(shot['videoPath'])
        source_hash = digest(source)
        name = re.sub(r'[^\w-]', '_', shot['shotNo'])
        output = output_dir / f'{name}-actual-last-{source_hash[:16]}.png'
        old = next((r for r in ledger['records'] if r.get('sourcePath') == str(source)
                    and r.get('sourceSha256') == source_hash and r.get('outputPath') == str(output)
                    and r.get('operation') == 'extract' and r.get('position') == 'last'), None)
        if old and output.exists() and digest(output) == old.get('outputSha256'):
            receipts.append(old)
            print(f"{shot['shotNo']}: reused verified final frame")
            continue
        if output.exists():
            raise RuntimeError(f'Existing unverified output will not be overwritten: {output}')
        frames = json.loads(run(args.ffprobe, '-v', 'error', '-select_streams', 'v:0',
            '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(source)))['frames']
        if not frames:
            raise RuntimeError(f'No decoded video frames: {source}')
        index = len(frames) - 1
        fd, temp = tempfile.mkstemp(prefix='tail-', suffix='.png', dir=output_dir)
        os.close(fd)
        try:
            run(args.ffmpeg, '-v', 'error', '-y', '-i', str(source), '-map', '0:v:0',
                '-vf', f'select=eq(n\\,{index})', '-fps_mode', 'passthrough', '-frames:v', '1', temp)
            if Path(temp).read_bytes()[:8] != b'\x89PNG\r\n\x1a\n' or digest(source) != source_hash:
                raise RuntimeError('Invalid PNG or source video changed during extraction')
            os.replace(temp, output)
        finally:
            Path(temp).unlink(missing_ok=True)
        receipt = {'sourcePath': str(source), 'outputPath': str(output), 'operation': 'extract',
            'position': 'last', 'frameIndex': index, 'frameCount': len(frames),
            'sourceSha256': source_hash, 'outputSha256': digest(output),
            'evidence': 'ffprobe-decoded-frames + ffmpeg-select-exact-index', 'shotNo': shot['shotNo']}
        if frames[-1].get('best_effort_timestamp_time') is not None:
            receipt['timeSec'] = float(frames[-1]['best_effort_timestamp_time'])
        receipts.append(receipt)
        print(f"{shot['shotNo']}: final decoded frame index={index}, time={receipt.get('timeSec')}s")
    # A user might adopt another video while extraction runs. Do not publish stale receipts.
    latest = json.loads(workshop.read_text())
    selected = lambda data: [(s.get('id'), s['shotNo'], s.get('videoPath')) for s in data['shots']]
    if selected(latest) != selected(snapshot):
        raise RuntimeError('Adopted video selection changed; ledger untouched')
    if (ledger_path.read_bytes() if ledger_path.exists() else None) != ledger_bytes:
        raise RuntimeError('Provenance ledger changed; refusing to overwrite concurrent edits')
    keys = {(r.get('sourcePath'), r.get('outputPath'), r.get('operation')) for r in receipts}
    ledger['records'] = [r for r in ledger['records'] if (r.get('sourcePath'), r.get('outputPath'), r.get('operation')) not in keys] + receipts
    payload = json.dumps(ledger, ensure_ascii=False, indent=2).encode()
    if payload != ledger_bytes:
        fd, temp = tempfile.mkstemp(prefix='provenance-', suffix='.json', dir=project)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, ledger_path)
        finally:
            Path(temp).unlink(missing_ok=True)
    print(f'Published {len(receipts)} actual-tail receipts; workshop inputs and videos unchanged.')


if __name__ == '__main__':
    main()
