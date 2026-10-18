import L from "leaflet";

/*
 * Leaflet puts every marker on a whole pixel. A vehicle that moves less than
 * a pixel a second (any regional zoom) then jumps one pixel every few seconds
 * instead of gliding. These two keep the fraction, so slow motion is smooth.
 */

type CircleInternals = {
    _map: L.Map;
    _latlng: L.LatLng;
    _point: L.Point;
    _updateBounds: () => void;
};

/** A canvas dot at its exact position. */
export class SmoothDot extends L.CircleMarker {
    _project() {
        const self = this as unknown as CircleInternals;

        self._point = self._map
            .project(self._latlng)
            .subtract(self._map.getPixelOrigin());
        self._updateBounds();
    }
}

type MarkerInternals = {
    _map: L.Map | null;
    _icon: HTMLElement | undefined;
    _latlng: L.LatLng;
    _setPos: (pos: L.Point) => void;
};

/** A group symbol at its exact position. */
export class SmoothMarker extends L.Marker {
    update() {
        const self = this as unknown as MarkerInternals;

        if (self._icon && self._map) {
            self._setPos(
                self._map
                    .project(self._latlng)
                    .subtract(self._map.getPixelOrigin()),
            );
        }

        return this;
    }
}
