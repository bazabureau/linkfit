<div class="mx-2 my-1">
    <?php if(count($checkResults?->storedCheckResults ?? [])): ?>
        <div class="w-full max-w-120 mb-1 py-1 text-white bg-blue-800">
            <span class="px-2 text-left w-1/2">Laravel Health Check Results</span>
            <span class="px-2 text-right w-1/2">
               Last ran all the checks
                <?php if($lastRanAt->diffInMinutes() < 1): ?>
                    just now
                <?php else: ?>
                    <?php echo e($lastRanAt->diffForHumans()); ?>

                <?php endif; ?>
            </span>
        </div>
        <?php $__currentLoopData = $checkResults->storedCheckResults; $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $result): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); ?>
            <div class="space-x-1">
                <span class="w-10">
                    <b class="uppercase <?php echo e($color($result->status)); ?>">
                        <?php echo e(ucfirst($result->status)); ?>

                    </b>
                </span>
                <span><?php echo e($result->label); ?></span>
                <span class="text-gray">›</span>
                <span class="<?php echo e($color($result->status)); ?>"> <?php echo e($result->shortSummary); ?></span>
            </div>
            <?php if($result->notificationMessage): ?>
            <div class="ml-11 text-gray">
                ⇂ <?php echo e($result->notificationMessage); ?>

            </div>
            <?php endif; ?>
        <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); ?>
    <?php else: ?>
        <div>
            No checks have run yet...<br />
            Please execute this command:
            <br /><br />
            <b>php artisan health:check</b>
        </div>
    <?php endif; ?>
</div>
<?php /**PATH /Users/kamrannamazov/Desktop/linkfit/apps/api-laravel/resources/views/vendor/health/list-cli.blade.php ENDPATH**/ ?>