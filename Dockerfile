FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

COPY . ./

EXPOSE 5173

CMD ["node", "server.mjs"]
