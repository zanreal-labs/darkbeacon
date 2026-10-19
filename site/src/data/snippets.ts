import { REPO_URL } from '../config';

/** The compose file and the three commands that start an instance (README, Self-host). */
export const compose = `services:
  darkbeacon:
    build: .
    restart: unless-stopped
    env_file: .env
    ports:
      - '3000:3000'
    volumes:
      - dbk-data:/data

volumes:
  dbk-data:`;

export const install = `git clone ${REPO_URL}.git && cd darkbeacon
cp .env.example .env
docker compose up -d`;
