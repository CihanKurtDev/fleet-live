import { LIST_PAGE_LIMIT_MAX } from "@fleet-live/shared";
import { useBoundHeight } from "./useBoundHeight";

/** Row and header heights of the list panel (`ListPage.module.scss`). */
const LIST_ROW_HEIGHT = 48;
const LIST_HEAD_HEIGHT = 38;

/**
 * Rows that fit the list body. Put `ref` on `ListBody`. While the body is
 * not height-bound (phones, first render) the page size is `fallback`.
 */
export function useListPageSize(fallback: number) {
    const { ref, height } = useBoundHeight<HTMLDivElement>();
    const pageSize =
        height > 0
            ? Math.min(
                  LIST_PAGE_LIMIT_MAX,
                  Math.max(
                      1,
                      Math.floor((height - LIST_HEAD_HEIGHT) / LIST_ROW_HEIGHT),
                  ),
              )
            : fallback;

    return { ref, pageSize, isMeasured: height > 0 };
}
