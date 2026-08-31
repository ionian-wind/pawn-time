export default {
  testEnvironment: 'node',
  transform: {},
  clearMocks: true,
  testMatch: ['**/__tests__/**/*.test.js', '**/?(*.)+(spec|test).js'],
  collectCoverageFrom: ['src/**/*.js'],
  setupFilesAfterEnv: ['./jest.setup.js'],
};
