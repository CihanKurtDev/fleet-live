const MAX_FOCUS_IDS = 150;

let focusIds: number[] = [];

export function setFocusIds(ids: number[]) {
    const unique: number[] = [];
    const seen = new Set<number>();

    for (const id of ids) {
        if (!Number.isInteger(id) || id < 1 || seen.has(id)) {
            continue;
        }

        seen.add(id);
        unique.push(id);

        if (unique.length >= MAX_FOCUS_IDS) {
            break;
        }
    }

    focusIds = unique;
}

export function getFocusIds(): number[] {
    return focusIds;
}

export function clearFocusIds() {
    focusIds = [];
}

export { MAX_FOCUS_IDS };
