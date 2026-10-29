# Spiral Galaxy

See your vault as a slowly spinning spiral galaxy.

![Spiral Galaxy](galaxy.jpg)

- **Every note is a star.** Notes with more links are bigger stars.
- **Every arm is a group of folders**, each in its own colour. Every folder is a glowing star cluster along its arm, with its hub note (Start Here, README, Index, Hub, MOC, Overview, or its most-linked note) in the middle.
- **Your top-level notes are the bright core.** The centre note (e.g. `Home.md`) sits in the very middle.
- **"Moon" folders** (references, archives, …) become a little satellite galaxy.

## Using it

Open it with the ✨ **sparkles** button in the ribbon, or the command **Spiral Galaxy: Open galaxy**.

| Do | What happens |
|---|---|
| Hover a star | Its name, its link count and lines to everything it links with |
| Click a star | Opens the note in a new tab |
| Scroll | Zoom (folder names fade in when you zoom in) |
| Drag empty space | Move around |
| Drag the bright middle | The galaxy follows like jelly: the arms trail behind and wobble into place |
| **Spin** button | Turn the slow spin on or off |

## Settings

- **Arms:** by default the arms are picked automatically from your folders. Every top-level folder becomes a star cluster; if one folder holds most of your vault, its subfolders are used instead. Press **Fill in from my folders** to edit them: name, colour and folders for each arm. Arms can be added, removed and moved.
- **Core:** which folders' loose notes form the bright core ("/" is the vault root), its name and colours, and the centre note.
- **Moon:** folders that become the satellite galaxy, and its name and colour.
- **Look and feel:** spin when opened, spin speed, space dust (none / light / normal / rich), jelly drag, and the legend.

Star positions are seeded from each note's path, so your galaxy looks the same every time, and new notes simply join their folder's cluster.

## Performance

The glowing nebulae, the space dust and the core glow are painted once into a single backdrop picture that is only turned and scaled as the galaxy spins. Every star is one pre-made sprite, and the view only redraws while something moves. A redraw takes about 1 ms for a vault of around 900 notes.

## Privacy

Everything happens inside Obsidian. The plugin makes no network requests and only reads your notes' paths and links.

## Installing by hand

Copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<your vault>/.obsidian/plugins/spiral-galaxy/`, then turn on **Spiral Galaxy** in Settings → Community plugins.

## Licence

MIT
