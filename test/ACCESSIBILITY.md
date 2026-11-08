# Earth Jukebox: 10-minute listener test

For a blind or low-vision tester. Use NVDA with Chrome (Windows) or VoiceOver with
Safari (Mac or iPhone). Headphones on, both ears if possible. Open the site link,
not a file. The tester drives; the observer only writes down what happens.

## Setup (1 minute)

- [ ] Volume on the computer at a comfortable level
- [ ] Screen reader running, browser on the Earth Jukebox page
- [ ] Observer has this sheet and a timer

## What the page should say (2 minutes)

Press Tab from the top of the page. Expected order and what the screen reader says:

1. "Skip to the player, link". Enter jumps to the Player section.
2. "Choose a track, grouping. A1 Ocean Fever, radio button, checked, 1 of 2. Sea surface temperature". Arrow keys change track.
3. "Play, button". After pressing it: "Pause, button".
   Then "Previous moment, button" and "Next moment, button".
4. "Time, slider, 2024-05-18, map average +0.6 degrees C. Moment 1 of 31". Arrow keys move one moment.
5. "Sound, grouping. Scan, radio button, checked". Arrow to "Planet Chord".
6. "Strict data mode, checkbox, not checked. Strict: plain tones on a continuous pitch, no musical scale or reverb."
7. "Describe this moment, button". Pauses the music and reads the moment.
8. "Key, button". Pauses the music and reads what every sound means.
   Then "Read aloud, checkbox, not checked" (leave it off with a screen reader).
   Then the globe: "View, grouping. Globe, radio button, checked", "Spin, toggle button, pressed", "Follow the scan, checkbox".
   Then "Hear the change": "Moment A, combo box", "Moment B, combo box", "Play A, then B, button".
9. "Listen to one spot, grouping. West to east, slider, 5 degrees east". Each arrow plays one note and says, for example, "15 degrees east, 5 degrees south: -0.3 degrees C".
10. "North to south, slider, 5 degrees south".
11. "Settings". Speed (Half, Normal, Double), Volume slider ("100 percent"), Mono checkbox, "Save as WAV, button".
12. Footer links: data source, Tone.js.

The page never talks on its own during playback. It speaks only after Describe,
Key, a track change, a cursor move or Save as WAV.

- [ ] Order matched, or note where it did not
- [ ] Every control had a clear name and value
- [ ] Nothing was announced that the tester did not ask for

## Controls check (2 minutes)

- [ ] Space on Play starts the music; Space again pauses it
- [ ] Changing track while playing keeps playing, with no doubled notes
- [ ] Planet Chord changes the sound within one bar, without stopping
- [ ] Mono on: sounds stay in the middle. Off: they move left to right again
- [ ] Double speed is clearly faster; Half clearly slower
- [ ] Save as WAV says "Rendering", then "Saved ...", and a file downloads
- [ ] Hear the change plays A, then B, then stops by itself; the list below it reads the difference
- [ ] Moving the listening cursor turns the globe to that spot; tapping the globe plays that spot
- [ ] With "Reduce motion" on in the system settings, the globe does not spin on its own
- [ ] Focus is always visible (yellow outline) for a low-vision tester
- [ ] At 200% browser zoom, nothing is cut off and no sideways scrolling

## The four listener tasks (5 minutes)

Give each task in these words. Do not help. Note time taken and what the tester says.

1. **Start Ocean Fever without help.**
   Pass: music playing within 60 seconds, starting from the top of the page.

2. **Find the warmest part of the map by ear.**
   Use Scan, or the listening cursor. Pass: the tester names a region (for example
   "the eastern Pacific, near South America") and it matches a warm patch on the map.

3. **Hear 2025 and 2026, and say which Pacific is warmer.**
   Choose A2 El Niño: then vs now and play. Pass: the tester says 2026 is warmer,
   using the low/high year cue, the bell, or Describe.

4. **Explain what the drone and the bell mean.**
   The tester may press Key first. Pass: the drone is the zero line (no change from
   normal); the bell means El Niño (the Niño 3.4 box is more than 0.5 degrees C warmer
   than the tropical ocean).

## Notes for the team

| Task | Passed? | Time | What confused the tester |
| --- | --- | --- | --- |
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
