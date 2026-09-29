"""Generate parity fixtures locally; personal recordings never enter web/public."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/python-reference'))
from shadowcoach.config import load_config
from shadowcoach.domain.enums import Move, Stance
from shadowcoach.pipeline import analyze_landmarks
from tests.conftest import recording


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--recorded-run', type=Path)
    args = parser.parse_args()
    shared = ROOT / 'shared/config/defaults.json'
    cfg = load_config(shared if shared.exists() else None)
    (ROOT / 'shared/config/defaults.json').write_text(json.dumps(cfg.model_dump(), indent=2) + '\n')
    examples = []
    for move in Move:
        for stance in Stance:
            for fps in (24, 30, 60):
                for variant in ('normal', 'dropped', 'no_return', 'wrong_hand', 'no_motion', 'world_missing'):
                    options = {} if variant == 'normal' else {'world': False} if variant == 'world_missing' else {variant: True}
                    frames, info = recording(move, stance, fps, **options)
                    report, _, _ = analyze_landmarks(frames, info, move, stance, cfg)
                    examples.append({'id': f'{move}_{stance}_{fps}_{variant}', 'frames': [f.model_dump() for f in frames], 'info': info.model_dump(), 'move': move, 'stance': stance, 'report': report.model_dump(mode='json')})
    (ROOT / 'shared/fixtures/synthetic.json').write_text(json.dumps(examples, separators=(',', ':')))
    if args.recorded_run:
        cases = []
        for folder in sorted((args.recorded_run / 'clips').iterdir()):
            if not (folder / 'report.json').is_file():
                continue
            report = json.loads((folder / 'report.json').read_text())
            raw = [json.loads(line) for line in (folder / 'landmarks.jsonl').read_text().splitlines()]
            frames = [{k: r[k] for k in ('frame', 'timestamp_ms', 'pose_count', 'landmarks', 'world_landmarks')} for r in raw]
            cases.append({'id': folder.name, 'frames': frames, 'info': report['video_info'], 'move': report['expected_move'], 'stance': report['stance'], 'report': report})
        (ROOT / 'private-data/recorded-parity.json').write_text(json.dumps(cases, separators=(',', ':')))
        print(f'{len(cases)} private recorded examples prepared (not published).')
    print(f'{len(examples)} synthetic examples; configuration exported from reference defaults.')


if __name__ == '__main__':
    main()
