from comic_studio.model_runtime.contracts import Capability


class CapabilityAdapterRegistry:
    def __init__(self, provider_factory):
        self.provider_factory = provider_factory

    def create(self, capability: Capability):
        provider_factory = (
            self.provider_factory()
            if callable(self.provider_factory)
            else self.provider_factory
        )
        method_name = {
            Capability.TEXT: "create_llm",
            Capability.IMAGE: "create_image",
            Capability.SPEECH: "create_tts",
            Capability.VIDEO: "create_video",
        }[capability]
        return getattr(provider_factory, method_name)()
