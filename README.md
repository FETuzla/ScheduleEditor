# Schedule Manager

A tool very similar to [ScheduleGenerator](https://fetuzla.github.io/ScheduleGenerator/) built to allow our vice dean to edit the schedule easier.

## Features

- View the weekly schedule rendered on a canvas, identical to ScheduleGenerator
- Edit, add, and delete rows via an in-page table
- Filter the schedule by year, orientation, professor, or room — independently for the canvas and the table
- Import schedule data via CSV upload
- Export the current schedule as a CSV, PNG image, or `.ics` calendar file
- Single admin user, session-based login

## Data format

The app stores data in `data/schedule.json`. Each row follows this schema:

| Field | Example |
|---|---|
| year | `Prva godina` |
| orientation | `Linija 1` |
| name | `Osnovi Programiranja 1` |
| displayName | `OP 1` |
| day | `Ponedjeljak` |
| startTime | `09:00` |
| endTime | `10:00` |
| location | `FF 008` |
| teacher | `as. Harun Delić` |
| type | `AV` |

## Running locally
```bash
cp .env.example .env   # fill in credentials
npm install
npm start              # http://localhost:3000
```

## Deploying with Docker
```bash
docker compose up -d
```

The app listens on `127.0.0.1:3000` by default and is intended to sit behind a reverse proxy. See the Apache vhost example below.
```apache
<VirtualHost *:443>
    ServerName raspored.yourdomain.com
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
</VirtualHost>
```

## Environment variables

| Variable | Description |
|---|---|
| `ADMIN_USERNAME` | Login username |
| `ADMIN_PASSWORD` | Login password |
| `SESSION_SECRET` | Secret used to sign session cookies |
| `PORT` | Port the app listens on (default `3000`) |