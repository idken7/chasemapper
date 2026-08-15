module.exports = {
  testEnvironment: 'jsdom',
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/js/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/js/helpers/'],
  verbose: true,
};
