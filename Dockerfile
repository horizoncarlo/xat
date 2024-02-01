FROM oven/bun

WORKDIR /usr/src/app

COPY server.ts .
COPY chat.html .
COPY package.json .
RUN bun install
RUN bun build server.ts --outdir .

ENV isProduction true

EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "server.ts" ]
