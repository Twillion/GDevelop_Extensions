import json

with open('SeaOfThieves_TechArt/frames_index.json') as f:
    frames = json.load(f)

for ch_name in ['Ocean: Performance & Simulation', 'Clouds: Rendering', 'Ropes Systems', 'Tentacles (Kraken)', 'Lightning & Wrap Up']:
    print('=== ' + ch_name + ' ===')
    sub = [x for x in frames if x['chapter'] == ch_name]
    for s in sub:
        print('  #{:3d} [{}] {}'.format(s['index'], s['timestamp'], s['filename']))
