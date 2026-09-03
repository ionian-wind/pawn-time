module.exports = {
  '**/*.(ts|tsx|js|cjs|mjs)': (filenames) => [
    `eslint --fix -- ${filenames.join(' ')}`,
    `prettier --ignore-path .gitignore --write -- ${filenames.join(' ')}`,
  ],
};
