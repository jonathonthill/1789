FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3789
CMD ["node", "server/index.js"]
