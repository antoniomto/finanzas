FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p data public/uploads auth_info_baileys

EXPOSE 3000

CMD ["node", "server.js"]
