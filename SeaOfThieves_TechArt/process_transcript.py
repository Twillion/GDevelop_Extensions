import json

chapters = [
    {'start_time': 0, 'end_time': 164, 'title': 'Introduction & Overview'},
    {'start_time': 164, 'end_time': 211, 'title': 'Art Direction'},
    {'start_time': 211, 'end_time': 322, 'title': 'Engine & Tooling'},
    {'start_time': 322, 'end_time': 506, 'title': 'Ocean: Exploration & Visual Targets'},
    {'start_time': 506, 'end_time': 891, 'title': 'Ocean: Performance & Simulation'},
    {'start_time': 891, 'end_time': 944, 'title': 'Clouds: Concept'},
    {'start_time': 944, 'end_time': 1032, 'title': 'Clouds: Iteration'},
    {'start_time': 1032, 'end_time': 1512, 'title': 'Clouds: Rendering'},
    {'start_time': 1512, 'end_time': 1867, 'title': 'Clouds: Limitations & Optimizations'},
    {'start_time': 1867, 'end_time': 2018, 'title': 'Ropes Systems'},
    {'start_time': 2018, 'end_time': 2066, 'title': 'Ropes: Performance'},
    {'start_time': 2066, 'end_time': 2291, 'title': 'Tentacles (Kraken)'},
    {'start_time': 2291, 'end_time': 2471, 'title': 'Lightning & Wrap Up'}
]

with open('SeaOfThieves_TechArt/transcript_raw.json', 'r', encoding='utf-8') as f:
    snippets = json.load(f)

def format_ts(seconds):
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m:02d}:{s:02d}"

lines = ['# The Technical Art of Sea of Thieves - Transcript\n\n']
lines.append('**Video URL:** https://www.youtube.com/watch?v=y9BOz2dFZzs  \n')
lines.append('**Talk by:** Rare Ltd. (Valentin Simonov & Team / Unreal Engine GDC Showcase)  \n')
lines.append('**Duration:** 41m 11s (2,471s)  \n\n')
lines.append('---\n\n')
lines.append('## Table of Contents\n\n')
for ch in chapters:
    lines.append(f"- [{ch['title']} ({format_ts(ch['start_time'])} - {format_ts(ch['end_time'])})](#{ch['title'].lower().replace(' ', '-').replace(':', '').replace('&', '').replace('(', '').replace(')', '')})\n")
lines.append('\n---\n\n')

current_ch_idx = 0
current_paragraph = []
para_start = 0

ch0 = chapters[0]
lines.append(f"## {ch0['title']} ({format_ts(ch0['start_time'])} - {format_ts(ch0['end_time'])})\n\n")

for item in snippets:
    start = item['start']
    text = item['text'].strip()
    
    # Check if we moved to next chapter
    while current_ch_idx < len(chapters) - 1 and start >= chapters[current_ch_idx + 1]['start_time']:
        if current_paragraph:
            lines.append(f"**[{format_ts(para_start)}]** " + " ".join(current_paragraph) + "\n\n")
            current_paragraph = []
        current_ch_idx += 1
        ch = chapters[current_ch_idx]
        lines.append(f"## {ch['title']} ({format_ts(ch['start_time'])} - {format_ts(ch['end_time'])})\n\n")
        para_start = start
    
    if not current_paragraph:
        para_start = start

    current_paragraph.append(text)
    
    # Break paragraph every ~5 items or ~25 seconds for pleasant reading
    if len(current_paragraph) >= 5 or (start - para_start) > 25:
        lines.append(f"**[{format_ts(para_start)}]** " + " ".join(current_paragraph) + "\n\n")
        current_paragraph = []

if current_paragraph:
    lines.append(f"**[{format_ts(para_start)}]** " + " ".join(current_paragraph) + "\n\n")

with open('SeaOfThieves_TechArt/TRANSCRIPT.md', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Saved formatted TRANSCRIPT.md successfully!")
