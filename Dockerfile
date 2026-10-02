FROM apify/actor-node:22

USER root
RUN npm install -g npm@11 --no-audit --no-fund \
    && npm cache clean --force \
    && rm -rf node_modules package-lock.json

USER myuser
COPY --chown=myuser:myuser package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --include=optional --package-lock=false \
    && node -e "import('impit').then((m) => console.log('impit OK:', Object.keys(m)))" \
    && rm -rf ~/.npm

COPY --chown=myuser:myuser . ./

ENV APIFY_LOG_LEVEL=INFO

CMD ["npm", "start", "--silent"]
