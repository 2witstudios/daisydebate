"""Pure DEC421 admission policy; byte thresholds are deliberately explicit."""
import math

GIB = 1024 ** 3
LIMITS = dict(scratch=20 * GIB, free=20 * GIB, available=2 * GIB, rss=8 * GIB)

def refusal(sample, limits=LIMITS):
    for field in ('scratch', 'free', 'available', 'rss', 'now', 'deadline'):
        if not isinstance(sample.get(field), (int, float)) or not math.isfinite(sample[field]) or sample[field] < 0:
            return 'invalid-sample'
    if sample['now'] >= sample['deadline']:
        return 'deadline'
    if sample['free'] < limits['free']:
        return 'free-disk'
    if sample['available'] < limits['available']:
        return 'available-memory'
    if sample['scratch'] > limits['scratch']:
        return 'scratch-cap'
    if sample['rss'] > limits['rss']:
        return 'aggregate-rss'
    return None
