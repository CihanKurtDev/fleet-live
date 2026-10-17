import type { Request, Response } from "express";
import { parseTodayQuery } from "@fleet-live/shared";

import { sessionCompany } from "../lib/http";
import { TodayModel } from "../models/today.model";

export function getToday(req: Request, res: Response) {
    const { limit } = parseTodayQuery(req.query);

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json(TodayModel.forCompany(sessionCompany(req), limit));
}
