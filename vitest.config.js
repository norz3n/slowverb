import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Глобальные настройки тестов
    globals: true,
    
    // Окружение для тестов
    environment: 'node',
    
    // Паттерны для поиска тестовых файлов
    include: ['tests/**/*.test.js', 'tests/**/*.property.test.js'],
    
    // Минимальное количество итераций для property-based тестов
    // задаётся в самих тестах через fast-check
    
    // Таймаут для тестов (мс)
    testTimeout: 10000,
    
    // Репортер
    reporters: ['verbose'],
  },
});
