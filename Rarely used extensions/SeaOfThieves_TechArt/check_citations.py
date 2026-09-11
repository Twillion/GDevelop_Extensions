import json

with open('SeaOfThieves_TechArt/transcript_raw.json') as f:
    snippets = json.load(f)

print('=== 1080s - 1140s (Pixar Potpourri talk) ===')
for s in snippets:
    if 1080 <= s['start'] <= 1140:
        print('{:6.1f}: {}'.format(s['start'], s['text']))

print('\n=== 290s - 340s (Tessendorf introduction) ===')
for s in snippets:
    if 290 <= s['start'] <= 340:
        print('{:6.1f}: {}'.format(s['start'], s['text']))

print('\n=== 390s - 430s (Tessendorf foam) ===')
for s in snippets:
    if 390 <= s['start'] <= 430:
        print('{:6.1f}: {}'.format(s['start'], s['text']))
