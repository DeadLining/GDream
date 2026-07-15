"""Capability dispatch + automatic provider registration.

A provider module under ``comic_studio.providers`` advertises itself with two
module-level/class-level hooks:

1. ``PROVIDER_CAPABILITY: Capability`` — the capability slot it occupies.
2. ``from_channel(channel, *, prefer_ssh_for_host=None)`` classmethod — builds an
   instance from a :class:`~comic_studio.provider_channels.ProviderChannel`.

``ProviderRegistry.discover_default()`` scans that directory at first use and
returns a ``{Capability: class}`` mapping, so new providers can be added by
dropping a file into the directory instead of editing import tables.
"""

from __future__ import annotations

import importlib
import pkgutil
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from typing import Any

from comic_studio.model_runtime.contracts import Capability

ProviderFactoryCallable = Callable[..., Any]


@dataclass(frozen=True)
class ProviderRegistration:
    """A single discovered provider entry."""

    capability: Capability
    provider_class: ProviderFactoryCallable
    module_name: str


@dataclass
class ProviderRegistry:
    """Maps each :class:`Capability` to the provider classes that serve it.

    Lookup precedence (highest first):

    1. An explicit override registered via :meth:`override` (used by tests that
       inject ``CapturingProvider``).
    2. The first provider registered for a capability (for backwards
       compatibility with single-provider setups).
    3. A provider discovered by scanning ``comic_studio.providers``.

    Multiple providers per capability are supported so that a future selector
    can rank them; callers that need a single class use :meth:`get`.
    """

    _providers: dict[Capability, list[ProviderRegistration]] = field(default_factory=dict)
    _overrides: dict[Capability, ProviderFactoryCallable] = field(default_factory=dict)

    def register(self, capability: Capability, provider_class: ProviderFactoryCallable, *, module_name: str = "") -> None:
        """Register a provider for ``capability``."""
        registration = ProviderRegistration(
            capability=capability,
            provider_class=provider_class,
            module_name=module_name or getattr(provider_class, "__module__", ""),
        )
        self._providers.setdefault(capability, []).append(registration)

    def override(self, capability: Capability, provider_class: ProviderFactoryCallable) -> None:
        """Bind an override for ``capability``; cleared by :meth:`clear_overrides`."""
        self._overrides[capability] = provider_class

    def clear_overrides(self) -> None:
        self._overrides.clear()

    def get(self, capability: Capability) -> ProviderFactoryCallable:
        if capability in self._overrides:
            return self._overrides[capability]
        try:
            return self._providers[capability][0].provider_class
        except (KeyError, IndexError) as exc:
            raise LookupError(f"No provider registered for capability {capability!r}") from exc

    def registrations(self) -> Iterator[ProviderRegistration]:
        for registrations in self._providers.values():
            yield from registrations

    def __contains__(self, capability: object) -> bool:
        return capability in self._providers or capability in self._overrides

    @classmethod
    def discover_default(cls, package: str = "comic_studio.providers") -> "ProviderRegistry":
        """Scan ``package`` and register every module exposing ``PROVIDER_CAPABILITY``."""
        registry = cls()
        for module_name, capability in _iter_provider_capabilities(package):
            module = importlib.import_module(module_name)
            class_name = getattr(capability, "_provider_class", None)
            provider_class = getattr(module, class_name) if class_name else None
            if provider_class is None:
                provider_class = _infer_single_provider_class(module, module_name)
            if provider_class is None:
                raise ImportError(
                    f"Module {module_name!r} declares PROVIDER_CAPABILITY but exposes no "
                    f"provider class (looked for {class_name!r})."
                )
            registry.register(
                capability.capability,
                provider_class,
                module_name=module_name,
            )
        return registry


@dataclass(frozen=True)
class _CapabilityMarker:
    """Module-level advertisement produced by :func:`register_capability`."""

    capability: Capability
    _provider_class: str | None = None


def register_capability(capability: Capability, *, provider_class: str | None = None) -> _CapabilityMarker:
    """Helper a provider module calls at import time to advertise itself.

    Example::

        # comic_studio/providers/minimax.py
        from comic_studio.model_runtime.adapters import register_capability
        from comic_studio.model_runtime.contracts import Capability

        PROVIDER_CAPABILITY = register_capability(Capability.TEXT, provider_class="MiniMaxProvider")
    """
    return _CapabilityMarker(capability=capability, _provider_class=provider_class)


def _iter_provider_capabilities(package: str) -> Iterable[tuple[str, _CapabilityMarker]]:
    try:
        package_module = importlib.import_module(package)
    except ModuleNotFoundError:
        return []
    path = getattr(package_module, "__path__", None)
    if not path:
        return []
    results: list[tuple[str, _CapabilityMarker]] = []
    for module_info in pkgutil.iter_modules(path):
        if module_info.ispkg:
            continue
        full_name = f"{package}.{module_info.name}"
        try:
            module = importlib.import_module(full_name)
        except ImportError:
            continue
        marker = getattr(module, "PROVIDER_CAPABILITY", None)
        if isinstance(marker, _CapabilityMarker):
            results.append((full_name, marker))
    return results


def _infer_single_provider_class(module: Any, module_name: str) -> ProviderFactoryCallable | None:
    """If ``provider_class`` wasn't named, pick the single public class in the module."""
    candidates = [
        obj
        for name, obj in vars(module).items()
        if isinstance(obj, type) and not name.startswith("_") and obj.__module__ == module_name
    ]
    classes_with_factory = [obj for obj in candidates if hasattr(obj, "from_channel")]
    if len(classes_with_factory) == 1:
        return classes_with_factory[0]
    return None


class CapabilityAdapterRegistry:
    """Bridge between a capability enum and a ``ProviderFactory``-like object."""

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
            Capability.MODEL_3D: "create_model3d",
        }[capability]
        return getattr(provider_factory, method_name)()
