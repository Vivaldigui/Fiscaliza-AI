module.exports = {
  ...require('./jest.config.cjs'),
  testRegex: '.*\\.integration-spec\\.ts$',
  coverageDirectory: 'coverage-integration',
};
