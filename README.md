# Spiral Galaxy

See your Obsidian vault as a slowly spinning spiral galaxy.

## ⬇️ [Download Spiral Galaxy](https://github.com/griff5562/spiral-galaxy/releases/latest/download/spiral-galaxy.zip)

## How to put it in your Obsidian

1. **Download** the zip with the link above, then **unzip** it (right-click → Extract All). You get a folder called `spiral-galaxy`.
2. **Find your vault's plugins folder.**
   - Open your vault folder (the folder with your notes in it).
   - Go into the `.obsidian` folder, then `plugins`. If there's no `plugins` folder, make one.
   - Can't see `.obsidian`? It's hidden.
     - Windows: in File Explorer, **View → Show → Hidden items**.
     - Mac: press **Cmd + Shift + .** in Finder.
   - Shortcut: in Obsidian, go to **Settings → Community plugins** and press the 📁 folder icon. It opens the plugins folder for you.
3. **Move the `spiral-galaxy` folder into `plugins`.** You should end up with `.obsidian/plugins/spiral-galaxy/main.js`.
4. **Turn it on in Obsidian.**
   - Go to **Settings → Community plugins**.
   - If it says Restricted mode is on, press **Turn on community plugins**.
   - Press the 🔄 refresh button next to "Installed plugins", then switch on **Spiral Galaxy**.
5. **Open it:** click the ✨ **sparkles** button on the left edge of Obsidian.

That's it!

## What it does

- **Every note is a star.** Notes with more links are bigger stars.
- **Every arm is a group of folders**, each in its own colour. Every folder is a glowing star cluster along its arm, with its hub note (Start Here, README, Index, Hub, MOC, Overview, or its most-linked note) in the middle.
- **Your top-level notes are the bright core.** The centre note (e.g. `Home.md`) sits in the very middle.
- **"Moon" folders** (references, archives, …) become a little satellite galaxy.

| Do | What happens |
|---|---|
| Hover a star | Its name, its link count and lines to everything it links with |
| Click a star | Opens the note in a new tab |
| Scroll | Zoom (folder names fade in when you zoom in) |
| Drag empty space | Move around |
| Drag the bright middle | The galaxy follows like jelly: the arms trail behind and wobble into place |
| **Spin** button | Turn the slow spin on or off |

## Settings

Find them in **Settings → Spiral Galaxy**.

- **Arms:** by default the arms are picked automatically from your folders. Every top-level folder becomes a star cluster; if one folder holds most of your vault, its subfolders are used instead. Press **Fill in from my folders** to edit them: name, colour and folders for each arm. Arms can be added, removed and moved.
- **Core:** which folders' loose notes form the bright core ("/" is the vault root), its name and colours, and the centre note.
- **Moon:** folders that become the satellite galaxy, and its name and colour.
- **Look and feel:** spin when opened, spin speed, space dust (none / light / normal / rich), jelly drag, and the legend.

Star positions are seeded from each note's path, so your galaxy looks the same every time, and new notes simply join their folder's cluster.

## Performance

The glowing nebulae, the space dust and the core glow are painted once into a single backdrop picture that is only turned and scaled as the galaxy spins. Every star is one pre-made sprite, and the view only redraws while something moves.

## Privacy

Everything happens inside Obsidian. The plugin makes no network requests and only reads your notes' paths and links.

## Licence

MIT
