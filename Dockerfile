FROM node:22-slim
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund && npm run build && npm prune --omit=dev
CMD ["node", "dist/index.js"]
