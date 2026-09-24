import { expect, test, type Page } from '@playwright/test';
import { encodePolyline } from '../src/lib/polyline';
import type { LonLat } from '../src/lib/geo';

// A short drive in Atlanta: the direct street passes a Flock camera; the detour doesn't.
const line = (from: number, to: number, lat: number): LonLat[] => {
  const points: LonLat[] = [];
  for (let lon = from; lon <= to + 1e-9; lon += 0.0005) points.push([Number(lon.toFixed(6)), lat]);
  return points;
};
const directShape = line(-84.3879, -84.3779, 33.7489);
const detourShape: LonLat[] = [[-84.3879, 33.7489], ...line(-84.3879, -84.3779, 33.7519), [-84.3779, 33.7489]];

function trip(points: LonLat[], seconds: number) {
  const km = (points.length - 1) * 0.0463;
  const middle = Math.floor(points.length / 2);
  return {
    legs: [{
      shape: encodePolyline(points),
      maneuvers: [
        { type: 1, instruction: 'Drive east on Peachtree Street.', verbal_pre_transition_instruction: 'Drive east on Peachtree Street.', street_names: ['Peachtree Street'], begin_shape_index: 0, end_shape_index: middle, length: km / 2, time: seconds / 2 },
        { type: 10, instruction: 'Turn right onto Edgewood Avenue.', verbal_pre_transition_instruction: 'Turn right onto Edgewood Avenue.', street_names: ['Edgewood Avenue'], begin_shape_index: middle, end_shape_index: points.length - 1, length: km / 2, time: seconds / 2 },
        { type: 4, instruction: 'You have arrived at your destination.', verbal_pre_transition_instruction: 'You have arrived at your destination.', begin_shape_index: points.length - 1, end_shape_index: points.length - 1, length: 0, time: 0 }
      ]
    }],
    summary: { length: km, time: seconds },
    units: 'kilometers'
  };
}

async function mockServices(page: Page) {
  await page.route('https://tiles.openfreemap.org/**', route => route.abort());
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.route('https://fonts.openmaptiles.org/**', route => route.abort());
  await page.route('https://photon.komoot.io/**', route => route.fulfill({
    json: { features: [{ geometry: { coordinates: [-84.3779, 33.7489] }, properties: { osm_type: 'N', osm_id: 1, name: 'Sweet Auburn Market', street: 'Edgewood Avenue', city: 'Atlanta', state: 'Georgia', countrycode: 'US' } }] }
  }));
  await page.route('https://uhuhuhuhuhuhuhuh.github.io/Raven/api/v1/osm/index.json', route => route.fulfill({
    json: { version: 1, dataTimestamp: '2026-09-23T20:22:04Z', tileSize: 0.5, count: 1, tiles: ['67_-169'], coverage: [{ hole: false, points: [[-90, 30], [-80, 30], [-80, 40], [-90, 40]] }] }
  }));
  await page.route('https://uhuhuhuhuhuhuhuh.github.io/Raven/api/v1/osm/tiles/**', route => route.fulfill({
    json: [[4242, 33.749, -84.3829, { man_made: 'surveillance', 'surveillance:type': 'ALPR', manufacturer: 'Flock Safety', direction: '90' }]]
  }));
  await page.route('https://valhalla1.openstreetmap.de/route', async route => {
    const body = route.request().postDataJSON() as { exclude_locations?: unknown[] };
    await route.fulfill({ json: { trip: body.exclude_locations?.length ? trip(detourShape, 150) : trip(directShape, 120) } });
  });
}

test('plans camera-free routes and drives one', async ({ page }) => {
  await mockServices(page);
  await page.goto('/?simSpeed=12');
  await expect(page.getByText('Avoiding Flock devices and all plate readers')).toBeVisible();
  await page.getByTestId('search-open').click();
  await page.getByLabel('Search places').fill('Sweet Auburn');
  await page.getByRole('button', { name: /Sweet Auburn Market/ }).click();

  const panel = page.getByTestId('route-panel');
  const fastest = panel.locator('.option[data-kind="fastest"]');
  await expect(fastest).toContainText('No cameras');
  await expect(fastest).toContainText('avoids 1 on the direct route');
  await expect(panel.locator('.option[data-kind="direct"]')).toContainText('1 camera');
  await expect(panel.getByRole('status')).toHaveCount(0, { timeout: 20_000 });
  await page.screenshot({ path: 'test-results/routes.png' });

  await panel.getByRole('button', { name: 'Preview drive' }).click();
  await expect(page.getByTestId('nav-banner')).toContainText(/Peachtree Street|Edgewood Avenue/);
  await expect(page.getByText('No cameras ahead')).toBeVisible();
  await page.screenshot({ path: 'test-results/navigate.png' });
  await expect(page.getByTestId('arrived')).toBeVisible({ timeout: 30_000 });
});

test('can drive the direct route and warns about the camera on it', async ({ page }) => {
  await mockServices(page);
  await page.goto('/?simSpeed=6');
  await page.getByTestId('search-open').click();
  await page.getByLabel('Search places').fill('Sweet Auburn');
  await page.getByRole('button', { name: /Sweet Auburn Market/ }).click();
  await page.locator('.option[data-kind="direct"]').click();
  await page.getByRole('button', { name: 'Preview drive' }).click();
  await expect(page.getByTestId('camera-alert')).toContainText('Flock Safety plate reader', { timeout: 20_000 });
  await page.screenshot({ path: 'test-results/alert.png' });
});

test('camera avoidance can be switched off', async ({ page }) => {
  await mockServices(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Avoid cameras' }).click();
  await page.screenshot({ path: 'test-results/settings.png' });
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Camera avoidance off')).toBeVisible();
  await page.getByTestId('search-open').click();
  await page.getByLabel('Search places').fill('Sweet Auburn');
  await page.getByRole('button', { name: /Sweet Auburn Market/ }).click();
  const options = page.locator('.option');
  await expect(options.first()).toContainText('1 camera');
  await expect(page.locator('.option[data-kind="direct"]')).toHaveCount(0);
});

test('lists music connectors including Plex', async ({ page }) => {
  await mockServices(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Music and audio apps' }).click();
  for (const name of ['Spotify', 'Plexamp', 'Plex', 'YouTube Music', 'Pandora']) {
    await expect(page.getByRole('dialog', { name: 'Music & audio' }).getByText(name, { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/connectors.png' });
});
