import cv2
import os
import json

video_path = 'SeaOfThieves_TechArt/video.mp4'
output_dir = 'SeaOfThieves_TechArt/frames'
os.makedirs(output_dir, exist_ok=True)

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

def get_chapter(sec):
    for ch in chapters:
        if ch['start_time'] <= sec < ch['end_time']:
            return ch['title']
    return chapters[-1]['title']

cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

step_seconds = 1.0  # Check every 1 second
step_frames = int(round(fps * step_seconds))

saved_frames = []
prev_small = None
last_saved_time = -999.0
min_interval = 4.0   # at least 4 seconds between frame captures unless forced
max_interval = 35.0  # capture at least every 35 seconds even if slide hasn't changed

frame_idx = 0
while frame_idx < total_frames:
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, frame = cap.read()
    if not ret:
        break
    
    current_time = frame_idx / fps
    small = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (160, 90))
    
    should_save = False
    diff_val = 0.0
    
    if prev_small is None:
        should_save = True
    else:
        time_since_last = current_time - last_saved_time
        # Mean absolute difference
        diff_val = cv2.absdiff(small, prev_small).mean()
        
        # If significant scene change and at least min_interval passed
        if diff_val > 15.0 and time_since_last >= min_interval:
            should_save = True
        elif time_since_last >= max_interval:
            should_save = True
            
    if should_save:
        m = int(current_time // 60)
        s = int(current_time % 60)
        ch_name = get_chapter(current_time)
        clean_ch = "".join(c for c in ch_name if c.isalnum() or c in (' ', '_')).strip().replace(' ', '_')
        filename = f"frame_{len(saved_frames)+1:03d}_{m:02d}m{s:02d}s_{clean_ch[:20]}.jpg"
        filepath = os.path.join(output_dir, filename)
        cv2.imwrite(filepath, frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
        
        saved_frames.append({
            'index': len(saved_frames) + 1,
            'filename': filename,
            'time_seconds': round(current_time, 2),
            'timestamp': f"{m:02d}:{s:02d}",
            'chapter': ch_name,
            'diff': round(float(diff_val), 2)
        })
        last_saved_time = current_time
        prev_small = small
    
    frame_idx += step_frames

cap.release()

with open('SeaOfThieves_TechArt/frames_index.json', 'w', encoding='utf-8') as f:
    json.dump(saved_frames, f, indent=2)

print(f"Extracted {len(saved_frames)} sample frames successfully!")
