import fs from 'node:fs';
import path from 'node:path';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const wantsJson = args.has('--json');
const withBuild = args.has('--with-build');
const withTests = args.has('--with-tests');

const checks = [];

function readFile(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function fileExists(relativePath) {
    return fs.existsSync(path.join(ROOT, relativePath));
}

function runCheck(name, fn) {
    try {
        const result = fn();
        const normalized = typeof result === 'string' ? {pass: true, detail: result} : result;
        checks.push({name, pass: normalized.pass, detail: normalized.detail ?? ''});
    } catch (error) {
        checks.push({name, pass: false, detail: error instanceof Error ? error.message : String(error)});
    }
}

function parseCaseTypes(source) {
    return new Set(Array.from(source.matchAll(/case '([^']+)'/g), (match) => match[1]));
}

function parseClassMethods(source) {
    const methods = new Set();
    for (const match of source.matchAll(/^\s*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/gm)) {
        const name = match[1];
        if (!['constructor', 'if', 'for', 'while', 'switch', 'catch'].includes(name)) {
            methods.add(name);
        }
    }
    for (const match of source.matchAll(/^\s*(get|set)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)) {
        methods.add(`${match[1]} ${match[2]}`);
    }
    return methods;
}

function diffMethods(threePath, babylonPath, allowedMissing = []) {
    const threeMethods = parseClassMethods(readFile(threePath));
    const babylonMethods = parseClassMethods(readFile(babylonPath));
    const allowed = new Set(allowedMissing);
    const missing = Array.from(threeMethods).filter((method) => !babylonMethods.has(method) && !allowed.has(method));
    return missing;
}

runCheck('Key parity files exist', () => {
    const required = [
        'packages/babylon.quarks/src/QuarksLoader.ts',
        'packages/babylon.quarks/src/QuarksPrefab.ts',
        'packages/babylon.quarks/src/materials/ParticleMaterials.ts',
        'packages/babylon.quarks/src/shaders/chunks/register-shader-chunks.ts',
    ];
    const missing = required.filter((file) => !fileExists(file));
    return {
        pass: missing.length === 0,
        detail: missing.length === 0 ? 'all required parity files found' : `missing files: ${missing.join(', ')}`,
    };
});

runCheck('Index exports cover three.quarks modules', () => {
    const threeIndex = readFile('packages/three.quarks/src/index.ts');
    const babylonIndex = readFile('packages/babylon.quarks/src/index.ts');
    const requiredModules = Array.from(threeIndex.matchAll(/export \* from '([^']+)';/g), (match) => match[1]);
    const missingModules = requiredModules.filter((modulePath) => !babylonIndex.includes(modulePath));
    const hasChunkRegistration = babylonIndex.includes('registerShaderChunks();');
    return {
        pass: missingModules.length === 0 && hasChunkRegistration,
        detail:
            missingModules.length === 0 && hasChunkRegistration
                ? 'all index exports and shader bootstrap are present'
                : `missing modules: ${missingModules.join(', ') || '(none)'}; registerShaderChunks: ${hasChunkRegistration}`,
    };
});

runCheck('QuarksPrefab supports ps + three timelines', () => {
    const prefabSource = readFile('packages/babylon.quarks/src/QuarksPrefab.ts');
    const requiredSnippets = [
        "type: 'three' | 'ps'",
        'addThreeAnimation(',
        'clipUUID',
        'resolveTimelineClip(',
    ];
    const missing = requiredSnippets.filter((snippet) => !prefabSource.includes(snippet));
    return {
        pass: missing.length === 0,
        detail: missing.length === 0 ? 'timeline API surface matches expected parity' : `missing snippets: ${missing.join(', ')}`,
    };
});

runCheck('QuarksLoader parseObject type coverage matches three', () => {
    const threeLoader = readFile('packages/three.quarks/src/QuarksLoader.ts');
    const babylonLoader = readFile('packages/babylon.quarks/src/QuarksLoader.ts');
    const threeCases = parseCaseTypes(threeLoader);
    const babylonCases = parseCaseTypes(babylonLoader);
    const missing = Array.from(threeCases).filter((caseType) => !babylonCases.has(caseType));
    return {
        pass: missing.length === 0,
        detail: missing.length === 0 ? `all ${threeCases.size} case types are covered` : `missing case types: ${missing.join(', ')}`,
    };
});

runCheck('Core class method parity (three -> babylon)', () => {
    const methodChecks = [
        ['ParticleSystem', 'packages/three.quarks/src/ParticleSystem.ts', 'packages/babylon.quarks/src/ParticleSystem.ts', []],
        ['QuarksUtil', 'packages/three.quarks/src/QuarksUtil.ts', 'packages/babylon.quarks/src/QuarksUtil.ts', []],
        ['ParticleEmitter', 'packages/three.quarks/src/ParticleEmitter.ts', 'packages/babylon.quarks/src/ParticleEmitter.ts', []],
        ['BatchedRenderer', 'packages/three.quarks/src/BatchedRenderer.ts', 'packages/babylon.quarks/src/BatchedRenderer.ts', []],
        ['MeshSurfaceEmitter', 'packages/three.quarks/src/MeshSurfaceEmitter.ts', 'packages/babylon.quarks/src/MeshSurfaceEmitter.ts', ['get geometry', 'set geometry']],
    ];
    const failures = [];
    for (const [name, threePath, babylonPath, allowedMissing] of methodChecks) {
        const missing = diffMethods(threePath, babylonPath, allowedMissing);
        if (missing.length > 0) {
            failures.push(`${name}: ${missing.join(', ')}`);
        }
    }
    return {
        pass: failures.length === 0,
        detail: failures.length === 0 ? 'no missing methods detected' : failures.join(' | '),
    };
});

runCheck('Material parity classes are exported', () => {
    const materialIndex = readFile('packages/babylon.quarks/src/materials/index.ts');
    const materialSource = readFile('packages/babylon.quarks/src/materials/ParticleMaterials.ts');
    const hasClasses =
        materialSource.includes('class ParticleMeshStandardMaterial') &&
        materialSource.includes('class ParticleMeshPhysicsMaterial');
    const exported = materialIndex.includes("export * from './ParticleMaterials';");
    return {
        pass: hasClasses && exported,
        detail: `classes:${hasClasses} exported:${exported}`,
    };
});

runCheck('Shader chunk parity registry is complete', () => {
    const threeRegister = readFile('packages/three.quarks/src/shaders/chunks/register-shader-chunks.ts');
    const babylonRegister = readFile('packages/babylon.quarks/src/shaders/chunks/register-shader-chunks.ts');
    const expectedChunks = Array.from(threeRegister.matchAll(/ShaderChunk\['([^']+)'\]/g), (match) => match[1]);
    const missing = expectedChunks.filter((chunkName) => !babylonRegister.includes(`shaderChunks.${chunkName}`));
    return {
        pass: missing.length === 0,
        detail: missing.length === 0 ? `all ${expectedChunks.length} chunk keys are registered` : `missing chunk keys: ${missing.join(', ')}`,
    };
});

runCheck('Parity-focused tests exist', () => {
    const requiredTests = [
        'packages/babylon.quarks/test/QuarksLoader.test.ts',
        'packages/babylon.quarks/test/QuarksPrefab.test.ts',
        'packages/babylon.quarks/test/ParticleMaterials.test.ts',
        'packages/babylon.quarks/test/ShaderChunks.test.ts',
    ];
    const missing = requiredTests.filter((file) => !fileExists(file));
    return {
        pass: missing.length === 0,
        detail: missing.length === 0 ? 'all parity tests are present' : `missing tests: ${missing.join(', ')}`,
    };
});

function runCommandCheck(name, command) {
    runCheck(name, () => {
        execSync(command, {cwd: ROOT, stdio: 'pipe', encoding: 'utf8'});
        return {pass: true, detail: command};
    });
}

if (withBuild) {
    runCommandCheck('Build babylon.quarks', 'npm run build --workspace=babylon.quarks');
}

if (withTests) {
    runCommandCheck('Run babylon.quarks tests', 'npm test --workspace=babylon.quarks -- --runInBand');
}

const passed = checks.filter((check) => check.pass).length;
const failed = checks.length - passed;

if (wantsJson) {
    console.log(JSON.stringify({passed, failed, checks}, null, 2));
} else {
    console.log('\nparity-audit: babylon.quarks vs three.quarks');
    console.log('------------------------------------------');
    for (const check of checks) {
        const icon = check.pass ? 'PASS' : 'FAIL';
        const detail = check.detail ? ` :: ${check.detail}` : '';
        console.log(`${icon} - ${check.name}${detail}`);
    }
    console.log('------------------------------------------');
    console.log(`Result: ${passed}/${checks.length} checks passed`);
    if (!withBuild || !withTests) {
        console.log('Tip: run with --with-build --with-tests for full runtime validation.');
    }
}

process.exit(failed > 0 ? 1 : 0);
