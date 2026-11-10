/** The compose file the installer writes (README, Self-host): the published image, one volume. */
export const compose = `services:
  darkbeacon:
    image: ghcr.io/zanreal-labs/darkbeacon:edge
    restart: unless-stopped
    env_file: .env
    ports:
      - '3000:3000'
    volumes:
      - dbk-data:/data

volumes:
  dbk-data:`;

/** One line: Docker in, an instance out (it asks for the address and the EVE application). */
export const install = `curl -fsSL https://darkbeacon.space/install.sh | sh`;


/** By hand, next to the compose file and an `.env` (PUBLIC_URL, SECRET_KEY, the EVE application). */
export const start = `docker compose up -d`;
