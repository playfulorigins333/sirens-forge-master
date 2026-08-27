FROM pytorch/pytorch:2.6.0-cuda12.6-cudnn9-runtime@sha256:f894dae26e1ee8557c544f9cfdb9dc011b1552bf3c1e656b422f2e221d380e40

ARG SD_SCRIPTS_COMMIT=37a1cbbc5725ed2a3575506e7bd2001c9908ac92
ARG KELPIE_VERSION=0.7.2
ARG KELPIE_SHA256=a0b98e9d44fb4ebbe3b8267e7545616a6814f9b07f9757e00ca84037b73f20f8

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/* \
    && git clone --filter=blob:none https://github.com/kohya-ss/sd-scripts /opt/sd-scripts \
    && git -C /opt/sd-scripts fetch --depth 1 origin "${SD_SCRIPTS_COMMIT}" \
    && git -C /opt/sd-scripts checkout --detach "${SD_SCRIPTS_COMMIT}" \
    && test "$(git -C /opt/sd-scripts rev-parse HEAD)" = "${SD_SCRIPTS_COMMIT}" \
    && python -m pip install --no-cache-dir -r /opt/sd-scripts/requirements.txt \
    && python -m pip install --no-cache-dir Pillow==11.1.0 \
    && curl --fail --location --output /tmp/kelpie \
       "https://github.com/SaladTechnologies/kelpie/releases/download/${KELPIE_VERSION}/kelpie" \
    && echo "${KELPIE_SHA256}  /tmp/kelpie" | sha256sum --check --strict \
    && install -m 0755 /tmp/kelpie /usr/local/bin/kelpie \
    && rm /tmp/kelpie

COPY executor.py /opt/sirens/executor.py
RUN mkdir -p /opt/sirens/input/dataset /opt/sirens/input/models \
    /opt/sirens/checkpoints /opt/sirens/output /opt/sirens/work

CMD ["/usr/local/bin/kelpie"]
