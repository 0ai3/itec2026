import { ESLint } from 'eslint';
import pluginSecurity from 'eslint-plugin-security';

const testCode = `
  const fs = require('fs');
  const userString = '1 + 1';
  eval('console.log(' + userString + ')');
`;

(async function main() {
	// 1. Create an instance
	const eslint = new ESLint({
		overrideConfigFile: true,
		overrideConfig: [{
			plugins: {
				security: pluginSecurity
			},
			languageOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
			},
			rules: {
				// Aici definim "lista neagră" de vulnerabilități! 'error' înseamnă că ne va da alertă roșie.
				'no-eval': 'error', 
                'security/detect-eval-with-expression': 'error',
                'security/detect-non-literal-fs-filename': 'warn'
            },
			}],
	});
// 2. Lint text.
	const results = await eslint.lintText(testCode);



	
	// 3. Format the results.
	const formatter = await eslint.loadFormatter("stylish");
	const resultText = formatter.format(results);

	// 4. Output it.
	console.log(resultText || "Nicio problemă de securitate găsită!");
})().catch(error => {
	process.exitCode = 1;
	console.error(error);



});