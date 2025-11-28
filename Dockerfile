FROM node:20-alpine

WORKDIR /app

# Установка зависимостей для production
COPY package*.json ./

# Используем npm install вместо npm ci (нет package-lock.json)
RUN npm install --omit=dev && npm cache clean --force

# Копируем исходники
COPY . .

# Создаем пользователя без прав root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

CMD ["node", "src/server.js"]