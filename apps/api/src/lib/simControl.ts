/**
 * Simulationspause pro Mandant. Der Prozess-Ticker bleibt eine Uhr;
 * ob eine Firma getickt wird, steht hier.
 */
const pausedCompanies = new Set<number>();

export function isCompanySimRunning(companyId: number): boolean {
    return !pausedCompanies.has(companyId);
}

export function setCompanySimRunning(companyId: number, running: boolean) {
    if (running) {
        pausedCompanies.delete(companyId);
        return;
    }

    pausedCompanies.add(companyId);
}

export function resetSimControlForTests() {
    pausedCompanies.clear();
}
