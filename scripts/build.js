/* Compilateur TypeScript minimal — lance tsc avec la config du projet. */
const path = require('path');
const ts = require('typescript');

const configPath = path.join(__dirname, '..', 'tsconfig.json');
const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => {
    console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    process.exit(1);
  },
});

if (!parsed) process.exit(1);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const emit = program.emit();
const diagnostics = ts
  .getPreEmitDiagnostics(program)
  .concat(emit.diagnostics);

for (const d of diagnostics) {
  const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  if (d.file && d.start !== undefined) {
    const pos = d.file.getLineAndCharacterOfPosition(d.start);
    console.error(`${d.file.fileName}:${pos.line + 1}:${pos.character + 1}  ${message}`);
  } else {
    console.error(message);
  }
}
process.exit(diagnostics.length ? 1 : 0);
