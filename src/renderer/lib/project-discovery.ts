// Figures out what kind of project is open by reading package.json (or
// Python markers) so the preview panel can offer a one-click dev server
// with the right command and port flag for that framework.

export interface ProjectProfile {
  id: string;
  label: string;
  defaultPort: number;
  buildCommand: (port: number) => string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

async function readTextFile(path: string): Promise<string | null> {
  const res = await window.electron.fs.readFile(path);
  if (res.error || res.content === undefined || res.content === null) return null;
  return res.content;
}

export async function discoverProject(projectPath: string): Promise<ProjectProfile | null> {
  const sep = projectPath.includes('\\') ? '\\' : '/';
  const join = (name: string) => `${projectPath}${sep}${name}`;

  const pkgRaw = await readTextFile(join('package.json'));
  if (pkgRaw) {
    let pkg: PackageJson | null = null;
    try {
      pkg = JSON.parse(pkgRaw) as PackageJson;
    } catch {
      pkg = null;
    }
    if (pkg) {
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const scripts = pkg.scripts || {};
      const has = (name: string) => name in deps;
      const hasScript = (name: string) => typeof scripts[name] === 'string';

      if (has('next')) {
        return {
          id: 'next',
          label: 'Next.js',
          defaultPort: 3000,
          buildCommand: (p) => (hasScript('dev') ? `npm run dev -- -p ${p}` : `npx next dev -p ${p}`),
        };
      }
      if (has('nuxt') || has('nuxt3')) {
        return {
          id: 'nuxt',
          label: 'Nuxt',
          defaultPort: 3000,
          buildCommand: (p) => (hasScript('dev') ? `npm run dev -- --port ${p}` : `npx nuxt dev --port ${p}`),
        };
      }
      if (has('astro')) {
        return {
          id: 'astro',
          label: 'Astro',
          defaultPort: 4321,
          buildCommand: (p) => (hasScript('dev') ? `npm run dev -- --port ${p}` : `npx astro dev --port ${p}`),
        };
      }
      if (has('@angular/cli') || has('@angular/core')) {
        return {
          id: 'angular',
          label: 'Angular',
          defaultPort: 4200,
          buildCommand: (p) => `npx ng serve --port ${p}`,
        };
      }
      if (has('@sveltejs/kit')) {
        return {
          id: 'sveltekit',
          label: 'SvelteKit',
          defaultPort: 5173,
          buildCommand: (p) => (hasScript('dev') ? `npm run dev -- --port ${p}` : `npx vite dev --port ${p}`),
        };
      }
      if (has('vite')) {
        return {
          id: 'vite',
          label: 'Vite',
          defaultPort: 5173,
          buildCommand: (p) => (hasScript('dev') ? `npm run dev -- --port ${p}` : `npx vite --port ${p}`),
        };
      }
      if (has('react-scripts')) {
        return {
          id: 'cra',
          label: 'Create React App',
          defaultPort: 3000,
          buildCommand: (p) => `PORT=${p} npm start`,
        };
      }
      if (has('@remix-run/dev')) {
        return {
          id: 'remix',
          label: 'Remix',
          defaultPort: 3000,
          buildCommand: () => (hasScript('dev') ? 'npm run dev' : 'npx remix dev'),
        };
      }
      if (has('express') || has('fastify') || has('koa') || has('hono')) {
        const script = hasScript('dev') ? 'dev' : hasScript('start') ? 'start' : null;
        return {
          id: 'node-server',
          label: 'Node server',
          defaultPort: 3000,
          buildCommand: (p) => (script ? `PORT=${p} npm run ${script}` : `PORT=${p} node .`),
        };
      }
      if (hasScript('dev') || hasScript('start')) {
        const script = hasScript('dev') ? 'dev' : 'start';
        return {
          id: 'node',
          label: 'Node project',
          defaultPort: 3000,
          buildCommand: (p) => `PORT=${p} npm run ${script}`,
        };
      }
    }
  }

  const managePy = await readTextFile(join('manage.py'));
  if (managePy !== null) {
    return {
      id: 'django',
      label: 'Django',
      defaultPort: 8000,
      buildCommand: (p) => `python3 manage.py runserver ${p}`,
    };
  }

  const requirements = await readTextFile(join('requirements.txt'));
  if (requirements) {
    const text = requirements.toLowerCase();
    if (text.includes('fastapi')) {
      return {
        id: 'fastapi',
        label: 'FastAPI',
        defaultPort: 8000,
        buildCommand: (p) => `python3 -m uvicorn main:app --reload --port ${p}`,
      };
    }
    if (text.includes('flask')) {
      return {
        id: 'flask',
        label: 'Flask',
        defaultPort: 5000,
        buildCommand: (p) => `python3 -m flask run --port ${p}`,
      };
    }
  }

  return null;
}
