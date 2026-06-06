# Museum

A small collection of retro, Commodore 64-styled web experiences built as interactive exhibits for a video game museum. Everything runs in a normal web browser but is dressed up to look and feel like a 1980s C64 (CRT bezel, scanlines, blocky pixel font, blue screen, SID-style bleeps).

## What's inside

### `build-your-own-game/`
The main exhibit: a "build your own game" kiosk. A visitor picks a language (Dutch, English, German, French), then answers 5 questions to design a game (players/enemies, genre, theme, speed, screen colours). After each choice the screen "types in" pages of fake BASIC code (with key-click sounds) and tallies how many hours that would have taken to type by hand back when there was no internet. The visitor names their game, then plays one of four real mini-games (shooter, maze, dodge, paddle) for ~2-3 minutes before the kiosk resets for the next person.

The answers don't literally generate code; they select and tune a handful of pre-built game engines, so every combination always works and starts instantly.


## How it's built

- The app has its own tiny Node static file server (`server.mjs`) so it can be opened in a browser and reached from other machines on the local network (handy for a kiosk).

## Running

The app is self-contained. From inside an app folder:

```
node server.mjs
```

then open the URL it prints (for example `http://127.0.0.1:3848/` for the build-your-own-game kiosk).

## Deploying (Ubuntu 24.04)

`install.sh` provisions a fresh Ubuntu 24.04 server: it installs NGINX and Node.js, runs `build-character/server.mjs` as a systemd service bound to localhost, puts NGINX in front of it as a reverse proxy, and obtains a Let's Encrypt SSL certificate (with HTTP -> HTTPS redirect) for a domain you configure.

```
cp deploy.config.example deploy.config   # set DOMAIN and LETSENCRYPT_EMAIL
sudo ./install.sh
```

