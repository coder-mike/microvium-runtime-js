import fs from 'fs'

const source = fs.readFileSync('./src/microvium/runtime-types.ts', 'utf8')

let lines = source.split(/\r?\n/g)

const startLine = lines.findIndex(line => line.includes('export enum mvm_TeError'))
if (!startLine) throw new Error('mvm_TeError not found')
lines = lines.slice(startLine + 1)
const endLine = lines.findIndex(line => line.includes('}'))
if (!endLine) throw new Error('mvm_TeError end not found')
lines = lines.slice(0, endLine)

const errorMessages = lines.map(line => {
  const match = line.match(/\/\*\s*(.*) \*\/ (\w+),?(?: \/\/ (.+))?$$/)
  if (!match) throw new Error('Invalid error line: ' + line);
  return {
    n: parseInt(match[1]),
    name: match[2],
    msg: match[3],
  };
});

fs.writeFileSync('src/microvium/error-messages.ts', `export const errorMessages = {\n${
  errorMessages.map((error) => {
    if (error.msg) {
      return `  ${error.n}: [${JSON.stringify(error.name)},${JSON.stringify(error.msg)}]`
    } else {
      return `  ${error.n}: [${JSON.stringify(error.name)}]`
    }
  }).join(',\n')
}\n} as const;`)
