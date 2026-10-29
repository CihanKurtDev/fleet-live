import type { Request, Response } from "express";
import { parseDomainInput } from "@fleet-live/shared";
import { DnsUnavailableError, lookupTxt } from "../lib/dnsTxt";
import {
    NotFoundError,
    ServiceUnavailableError,
    UnauthorizedError,
    ValidationError,
} from "../lib/errors";
import { AuditModel } from "../models/audit.model";
import { CompanyDomainModel } from "../models/companyDomain.model";

function companyOf(req: Request): { companyId: number; userId: number } {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    return { companyId: req.user.company_id, userId: req.user.id };
}

function domainId(req: Request): number {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
        throw new NotFoundError("Domain nicht gefunden.");
    }

    return id;
}

export function listDomains(req: Request, res: Response) {
    const { companyId } = companyOf(req);
    res.json({ data: CompanyDomainModel.list(companyId) });
}

export function addDomain(req: Request, res: Response) {
    const { companyId, userId } = companyOf(req);
    const { domain } = parseDomainInput(req.body);
    const created = CompanyDomainModel.add(companyId, domain);

    AuditModel.record({
        companyId,
        action: "domain_added",
        actorId: userId,
        details: { domain },
    });
    res.status(201).json({ data: created });
}

/** Looks the TXT record up and confirms the domain when it carries our value. */
export async function verifyDomain(req: Request, res: Response) {
    const { companyId, userId } = companyOf(req);
    const domain = CompanyDomainModel.find(companyId, domainId(req));

    if (!domain) {
        throw new NotFoundError("Domain nicht gefunden.");
    }

    if (!domain.verified_at) {
        let values: string[];

        try {
            values = await lookupTxt(domain.record_name);
        } catch (caught: unknown) {
            if (caught instanceof DnsUnavailableError) {
                throw new ServiceUnavailableError(
                    "Der DNS-Server antwortet gerade nicht. Bitte später erneut prüfen.",
                    "DNS_UNAVAILABLE",
                );
            }

            throw caught;
        }

        if (!values.includes(domain.record_value)) {
            throw new ValidationError(
                "Den TXT-Eintrag finden wir noch nicht. Neue DNS-Einträge brauchen oft einige Minuten, manchmal Stunden.",
            );
        }

        CompanyDomainModel.markVerified(companyId, domain.id, domain.domain);
        AuditModel.record({
            companyId,
            action: "domain_verified",
            actorId: userId,
            details: { domain: domain.domain },
        });
    }

    res.json({ data: CompanyDomainModel.list(companyId) });
}

export function removeDomain(req: Request, res: Response) {
    const { companyId, userId } = companyOf(req);
    const domain = CompanyDomainModel.find(companyId, domainId(req));

    if (!domain || !CompanyDomainModel.remove(companyId, domain.id)) {
        throw new NotFoundError("Domain nicht gefunden.");
    }

    AuditModel.record({
        companyId,
        action: "domain_removed",
        actorId: userId,
        details: { domain: domain.domain },
    });
    res.json({ data: CompanyDomainModel.list(companyId) });
}
