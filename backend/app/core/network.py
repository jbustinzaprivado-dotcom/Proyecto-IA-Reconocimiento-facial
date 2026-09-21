from starlette.requests import Request


def client_ip(request: Request, trust_forwarded: bool) -> str | None:
    """The address the request came from.

    Behind a proxy of ours every request comes from the proxy, so with `trust_forwarded` the last
    address of X-Forwarded-For is used: that is the one our own proxy added. Any earlier one could
    have been written by the client, which is why it is not used."""
    if trust_forwarded:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            last = forwarded.split(",")[-1].strip()
            if last:
                return last[:45]
    return request.client.host if request.client else None
