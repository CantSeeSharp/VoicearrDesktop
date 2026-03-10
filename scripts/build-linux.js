const { execSync } = require('child_process')
const cwd = process.cwd()

execSync(
  `docker run --rm -v "${cwd}:/project" -w /project electronuserland/builder sh -c "npm install && npm run dist:linux:raw"`,
  { stdio: 'inherit' }
)
